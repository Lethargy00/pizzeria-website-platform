/// <reference types="node" />
/**
 * Mock webhook adapter (ADR 0001, #49). The default in dev and tests.
 *
 * It does everything a real sender does except open a socket: it validates the URL and secret,
 * builds the body, signs every attempt with real HMAC-SHA256, vets every resolved address
 * against the SSRF rules, retries with backoff, and records each attempt in memory. The last
 * step (the network) is an injectable {@link WebhookTransport}; the default transport records
 * and answers `200` without any network call. A real provider adapter reuses this file's rules
 * and replaces only the transport and the resolver.
 *
 * ## Retry policy (this answers "specify retry count and backoff")
 * {@link WEBHOOK_RETRY_POLICY}: at most **3 attempts** per `notify` call, waiting **1 s** after
 * the first failure and **4 s** after the second. Retried: `throttled` (429), `timeout` (per
 * attempt timeout or 408) and `unavailable` (5xx, network). Not retried: `rejected`,
 * `misconfigured`. Each attempt is re-signed with a fresh timestamp and re-vets the addresses.
 * The caller's `timeoutMs` (default 30 s) bounds the whole call including waits; when the
 * remaining time cannot cover the next wait, the last error is thrown. Each attempt is also
 * capped at {@link WEBHOOK_ATTEMPT_TIMEOUT_MS} (10 s).
 *
 * Logging: at most `id`, `type`, `status`, `attempts`. Never `data`, URL, secret or any
 * response body.
 */

import { IsoDateTime } from '@pwp/schema/primitives';
import { AdapterError, WEBHOOK_ENV, WEBHOOK_HEADERS } from '../interfaces/index.js';
import type {
  AdapterCallOptions,
  AdapterEnv,
  AdapterErrorCode,
  AdapterFactory,
  WebhookDeliveryResult,
  WebhookEvent,
  WebhookNotifier,
} from '../interfaces/index.js';
import { buildSignatureHeader, isStrongWebhookSecret } from './signature.js';
import { bareHost, isBlockedAddress, isIpLiteral } from './ssrf.js';

const NAME = 'mock-webhook' as const;

export { isStrongWebhookSecret, signWebhook, verifyWebhookSignature } from './signature.js';
export type { VerifyWebhookInput } from './signature.js';
export { isBlockedAddress } from './ssrf.js';

/** Retry schedule. Frozen so it cannot be changed at runtime. */
export const WEBHOOK_RETRY_POLICY = Object.freeze({
  maxAttempts: 3,
  /** Wait after failed attempt 1, then after failed attempt 2. */
  backoffMs: Object.freeze([1000, 4000]) as readonly number[],
});
/** Cap for one attempt (connect + send + drain). */
export const WEBHOOK_ATTEMPT_TIMEOUT_MS = 10_000;
/** Default bound for a whole `notify` call. */
export const WEBHOOK_DEFAULT_TIMEOUT_MS = 30_000;
/** At most this many response-body bytes are read, only to drain the connection. */
export const WEBHOOK_MAX_RESPONSE_BYTES = 4096;
const MAX_BODY_BYTES = 256 * 1024;
const HEADER_SAFE_RE = /^[A-Za-z0-9._:-]{1,128}$/;
const EVENT_TYPES = new Set(['contact.submitted', 'catering.requested', 'reservation.requested']);

/** What the adapter hands to the network layer. `ip` is the vetted address to connect to. */
export interface WebhookTransportRequest {
  /** Vetted address to connect to. Do not resolve `hostname` again. */
  readonly ip: string;
  /** Original host: use for TLS SNI and the `Host` header. */
  readonly hostname: string;
  readonly port: number;
  /** Path plus query. May carry a token: never log it. */
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  /** Aborted when the attempt times out. The transport must stop work. */
  readonly signal: AbortSignal;
  /** Redirects must not be followed; a `3xx` is returned as is. */
  readonly followRedirects: false;
  /** The adapter reads at most this many bytes of the response body. */
  readonly maxResponseBytes: number;
}

export interface WebhookTransportResponse {
  readonly status: number;
  /** Response body, pulled lazily. The adapter stops pulling after 4 KiB and calls `return()`. */
  readonly body?: AsyncIterable<Uint8Array>;
}

export interface WebhookTransport {
  send(request: WebhookTransportRequest): Promise<WebhookTransportResponse>;
}

/** Resolves a host name to all of its addresses. The mock default does no DNS lookup. */
export type WebhookResolver = (hostname: string) => Promise<readonly string[]>;

/** One attempt as recorded. Holds PII (`body`): only for tests, never log it. */
export interface MockWebhookDelivery {
  readonly attempt: number;
  readonly ip: string;
  readonly hostname: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  /** HTTP status the transport answered, or `undefined` if it failed. */
  readonly status?: number;
}

export interface MockWebhookLogger {
  info(entry: {
    readonly id: string;
    readonly type: string;
    readonly status: number;
    readonly attempts: number;
  }): void;
}

export interface MockWebhookOptions {
  /** `https:` URL. Secret. */
  readonly url: string;
  /** Signing key. At least 43 base64url or 64 hex characters. Secret. */
  readonly secret: string;
  /** Optional second key, signed in addition during rotation. Secret. */
  readonly previousSecret?: string;
  readonly transport?: WebhookTransport;
  readonly resolve?: WebhookResolver;
  /** Clock in milliseconds. */
  readonly now?: () => number;
  /** Waits between attempts. Tests inject a fake one. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Per-attempt cap in ms. Default {@link WEBHOOK_ATTEMPT_TIMEOUT_MS}. */
  readonly attemptTimeoutMs?: number;
  readonly logger?: MockWebhookLogger;
}

export interface MockWebhookNotifier extends WebhookNotifier {
  /** Every attempt made so far, oldest first. */
  readonly deliveries: readonly MockWebhookDelivery[];
  reset(): void;
}

function fail(code: AdapterErrorCode, message: string): AdapterError {
  return new AdapterError('webhook', NAME, code, message);
}

/**
 * What the default resolver answers for any host name. It must be global unicast to pass the
 * SSRF allow-list (documentation ranges such as TEST-NET-3 are refused). Nothing ever connects
 * to it: the default transport opens no socket.
 */
export const MOCK_RESOLVED_ADDRESS = '8.8.8.8';

/** Offline stand-in for DNS: IP literals resolve to themselves, names to a fixed address. */
const defaultResolve: WebhookResolver = (hostname) =>
  Promise.resolve(isIpLiteral(hostname) ? [hostname] : [MOCK_RESOLVED_ADDRESS]);

/** Default transport: records only (the notifier does that) and answers 200. No network. */
const defaultTransport: WebhookTransport = {
  send: () => Promise.resolve({ status: 200 }),
};

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

function parseTarget(url: string): { hostname: string; host: string; port: number; path: string } {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw fail('misconfigured', `${WEBHOOK_ENV.url} is missing or invalid`);
  }
  if (u.protocol !== 'https:') throw fail('misconfigured', `${WEBHOOK_ENV.url} must use https`);
  if (u.username !== '' || u.password !== '' || u.hostname === '') {
    throw fail('misconfigured', `${WEBHOOK_ENV.url} is missing or invalid`);
  }
  return {
    hostname: u.hostname,
    host: bareHost(u.hostname),
    port: u.port === '' ? 443 : Number(u.port),
    path: `${u.pathname}${u.search}`,
  };
}

function validateEvent(event: WebhookEvent): string {
  if (!HEADER_SAFE_RE.test(event.id) || !EVENT_TYPES.has(event.type)) {
    throw fail('invalid_input', 'invalid webhook event');
  }
  // Types are erased at runtime: a caller that bypasses them must not reach a receiver with a
  // malformed timestamp (#178). Fixed message, no cause: the rejected value is never echoed.
  if (!IsoDateTime.safeParse(event.occurredAt).success) {
    throw fail('invalid_input', 'invalid webhook event');
  }
  const body = JSON.stringify(event);
  if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) {
    throw fail('invalid_input', 'webhook event too large');
  }
  return body;
}

/** Reads at most {@link WEBHOOK_MAX_RESPONSE_BYTES}, discards them, then closes the stream. */
async function drain(body: AsyncIterable<Uint8Array> | undefined): Promise<void> {
  if (body === undefined) return;
  const it = body[Symbol.asyncIterator]();
  try {
    let read = 0;
    while (read < WEBHOOK_MAX_RESPONSE_BYTES) {
      const r = await it.next();
      if (r.done === true) return;
      read += r.value.byteLength;
    }
    await it.return?.();
  } catch {
    // The status is already known; a broken body is not an error and is never reported.
  }
}

function statusToError(status: number): AdapterError | null {
  if (status >= 200 && status < 300) return null;
  if (status >= 300 && status < 400)
    return fail('rejected', 'webhook receiver redirected (not followed)');
  if (status === 429) return fail('throttled', 'webhook receiver throttled the request');
  if (status === 408) return fail('timeout', 'webhook receiver timed out');
  if (status >= 400 && status < 500)
    return fail('rejected', 'webhook receiver rejected the request');
  return fail('unavailable', 'webhook receiver unavailable');
}

export function createMockWebhookNotifier(options: MockWebhookOptions): MockWebhookNotifier {
  const target = parseTarget(options.url);
  const secrets = [options.secret];
  if (!isStrongWebhookSecret(options.secret)) {
    throw fail('misconfigured', `${WEBHOOK_ENV.secret} is missing or too weak`);
  }
  if (options.previousSecret !== undefined) {
    if (!isStrongWebhookSecret(options.previousSecret)) {
      throw fail('misconfigured', `${WEBHOOK_ENV.previousSecret} is too weak`);
    }
    secrets.push(options.previousSecret);
  }
  const transport = options.transport ?? defaultTransport;
  const resolve = options.resolve ?? defaultResolve;
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? defaultSleep;
  const attemptCap = options.attemptTimeoutMs ?? WEBHOOK_ATTEMPT_TIMEOUT_MS;
  const deliveries: MockWebhookDelivery[] = [];

  /** Refuses the delivery when any resolved address is blocked; returns the vetted IP. */
  async function vet(): Promise<string> {
    let addresses: readonly string[];
    try {
      addresses = await resolve(target.host);
    } catch {
      throw fail('unavailable', 'webhook host could not be resolved');
    }
    const first = addresses[0];
    if (first === undefined || addresses.some((a) => isBlockedAddress(a))) {
      throw fail('misconfigured', 'webhook target is not allowed');
    }
    return first;
  }

  async function attemptOnce(
    event: WebhookEvent,
    body: string,
    attempt: number,
    timeoutMs: number,
  ): Promise<number> {
    const ip = await vet();
    const timestamp = Math.floor(now() / 1000);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json; charset=utf-8',
      [WEBHOOK_HEADERS.event]: event.type,
      [WEBHOOK_HEADERS.idempotencyKey]: event.id,
      [WEBHOOK_HEADERS.timestamp]: String(timestamp),
      [WEBHOOK_HEADERS.signature]: buildSignatureHeader(secrets, timestamp, body),
    };
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(fail('timeout', 'webhook attempt timed out'));
      }, timeoutMs);
    });
    const index = deliveries.length;
    deliveries.push({ attempt, ip, hostname: target.hostname, headers, body });
    const run = async (): Promise<number> => {
      let status: number;
      try {
        const res = await transport.send({
          ip,
          hostname: target.hostname,
          port: target.port,
          path: target.path,
          headers,
          body,
          signal: controller.signal,
          followRedirects: false,
          maxResponseBytes: WEBHOOK_MAX_RESPONSE_BYTES,
        });
        status = res.status;
        const rec = deliveries[index];
        if (rec !== undefined) deliveries[index] = { ...rec, status };
        await drain(res.body);
      } catch (e) {
        if (e instanceof AdapterError) throw e;
        // Transport errors often embed the URL: replace them, do not chain them as `cause`.
        throw fail('unavailable', 'webhook request failed');
      }
      return status;
    };
    try {
      return await Promise.race([run(), timedOut]);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    name: NAME,
    get deliveries() {
      return deliveries;
    },
    reset() {
      deliveries.length = 0;
    },
    async notify(
      event: WebhookEvent,
      callOptions?: AdapterCallOptions,
    ): Promise<WebhookDeliveryResult> {
      const body = validateEvent(event);
      const deadline = now() + (callOptions?.timeoutMs ?? WEBHOOK_DEFAULT_TIMEOUT_MS);
      let lastError: AdapterError = fail('unavailable', 'webhook delivery failed');
      /** Attempts made by this call only (`deliveries` spans every call since `reset()`). */
      let attempts = 0;

      for (let attempt = 1; attempt <= WEBHOOK_RETRY_POLICY.maxAttempts; attempt++) {
        const remaining = deadline - now();
        if (remaining <= 0) {
          // The deadline passed before this attempt (before the first one, or during a wait).
          // Break, not throw: the failure log below must run on every failed exit (#121).
          if (attempt === 1) lastError = fail('timeout', 'webhook timed out');
          break;
        }
        let status = 0;
        attempts = attempt;
        try {
          status = await attemptOnce(event, body, attempt, Math.min(attemptCap, remaining));
          const err = statusToError(status);
          if (err === null) {
            options.logger?.info({ id: event.id, type: event.type, status, attempts: attempt });
            return { status, attempts: attempt };
          }
          lastError = err;
        } catch (e) {
          lastError = e instanceof AdapterError ? e : fail('unavailable', 'webhook request failed');
        }
        if (!lastError.retryable || attempt === WEBHOOK_RETRY_POLICY.maxAttempts) break;
        const wait = WEBHOOK_RETRY_POLICY.backoffMs[attempt - 1] ?? 0;
        if (deadline - now() <= wait) break;
        await sleep(wait);
      }
      // Single failure exit: every failed path above breaks out of the loop to here (#121).
      // `attempts` is the number of attempts this call made, 0 if the deadline had already passed.
      options.logger?.info({
        id: event.id,
        type: event.type,
        status: 0,
        attempts,
      });
      throw lastError;
    },
  };
}

/** `AdapterFactory` for site config discovery. */
export const factory: AdapterFactory<'webhook', WebhookNotifier> = {
  kind: 'webhook',
  name: NAME,
  env: [
    {
      name: WEBHOOK_ENV.url,
      secret: true,
      required: true,
      description: 'Target URL, https only. Secret: URLs often embed tokens.',
    },
    {
      name: WEBHOOK_ENV.secret,
      secret: true,
      required: true,
      description: 'HMAC key, at least 64 hex or 43 base64url characters.',
    },
    {
      name: WEBHOOK_ENV.previousSecret,
      secret: true,
      required: false,
      description: 'Previous HMAC key, also signed during rotation.',
    },
  ],
  create(env: AdapterEnv): WebhookNotifier {
    const previous = env[WEBHOOK_ENV.previousSecret];
    return createMockWebhookNotifier({
      url: env[WEBHOOK_ENV.url] ?? '',
      secret: env[WEBHOOK_ENV.secret] ?? '',
      ...(previous !== undefined && previous !== '' ? { previousSecret: previous } : {}),
    });
  },
};
