/// <reference types="node" />
import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { AdapterError, WEBHOOK_HEADERS, WEBHOOK_TOLERANCE_SECONDS } from '../interfaces/index.js';
import type { WebhookEvent } from '../interfaces/index.js';
import {
  WEBHOOK_MAX_RESPONSE_BYTES,
  WEBHOOK_RETRY_POLICY,
  createMockWebhookNotifier,
  factory,
  verifyWebhookSignature,
} from './index.js';
import type {
  MockWebhookOptions,
  WebhookTransport,
  WebhookTransportRequest,
  WebhookTransportResponse,
} from './index.js';

const SECRET = 'a'.repeat(64);
const OLD_SECRET = 'b'.repeat(64);
const URL_WITH_TOKEN = 'https://hooks.example.se/in/SUPER-SECRET-TOKEN?k=abc';

const EVENT: WebhookEvent = {
  id: '3f1c2a54-8d0e-4c43-9a55-1b2f3c4d5e6f',
  type: 'contact.submitted',
  tenant: 'exempel',
  occurredAt: '2026-11-20T12:00:00.000Z',
  version: 1,
  data: { name: 'Anna Andersson', message: 'Hej! Boka bord?' },
};

const noSleep = (): Promise<void> => Promise.resolve();

function make(over: Partial<MockWebhookOptions> = {}) {
  const sent: WebhookTransportRequest[] = [];
  const respond = over.transport ?? {
    send: (): Promise<WebhookTransportResponse> => Promise.resolve({ status: 200 }),
  };
  const transport: WebhookTransport = {
    send(req) {
      sent.push(req);
      return respond.send(req);
    },
  };
  const notifier = createMockWebhookNotifier({
    url: URL_WITH_TOKEN,
    secret: SECRET,
    sleep: noSleep,
    ...over,
    transport,
  });
  return { notifier, sent };
}

function statuses(...codes: number[]): WebhookTransport {
  let i = 0;
  return {
    send: () => Promise.resolve({ status: codes[Math.min(i++, codes.length - 1)] ?? 500 }),
  };
}

async function failure(p: Promise<unknown>): Promise<AdapterError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(AdapterError);
    return e as AdapterError;
  }
  throw new Error('expected rejection');
}

describe('mock-webhook: delivery, signing and retries', () => {
  it('delivers once with the contract headers and a body that is exactly what is signed', async () => {
    const { notifier, sent } = make({ now: () => 1_700_000_000_000 });
    const res = await notifier.notify(EVENT);
    expect(res).toEqual({ status: 200, attempts: 1 });
    const req = sent[0];
    expect(req?.body).toBe(JSON.stringify(EVENT));
    expect(req?.headers[WEBHOOK_HEADERS.event]).toBe('contact.submitted');
    expect(req?.headers[WEBHOOK_HEADERS.idempotencyKey]).toBe(EVENT.id);
    expect(req?.headers[WEBHOOK_HEADERS.timestamp]).toBe('1700000000');
    const expected = createHmac('sha256', Buffer.from(SECRET, 'utf8'))
      .update(`1700000000.${JSON.stringify(EVENT)}`)
      .digest('hex');
    expect(req?.headers[WEBHOOK_HEADERS.signature]).toBe(`v1=${expected}`);
    expect(notifier.deliveries).toHaveLength(1);
  });

  it('makes no network call by default (default transport only records)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const notifier = createMockWebhookNotifier({ url: URL_WITH_TOKEN, secret: SECRET });
    await expect(notifier.notify(EVENT)).resolves.toEqual({ status: 200, attempts: 1 });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('signature verifies with the reference verifier and fails when tampered or stale', async () => {
    const { notifier, sent } = make();
    await notifier.notify(EVENT);
    const h = sent[0]?.headers ?? {};
    const base = {
      secrets: [SECRET],
      timestampHeader: h[WEBHOOK_HEADERS.timestamp] ?? '',
      signatureHeader: h[WEBHOOK_HEADERS.signature] ?? '',
      rawBody: sent[0]?.body ?? '',
    };
    expect(verifyWebhookSignature(base)).toBe(true);
    expect(verifyWebhookSignature({ ...base, rawBody: `${base.rawBody} ` })).toBe(false);
    expect(verifyWebhookSignature({ ...base, secrets: [OLD_SECRET] })).toBe(false);
    const ts = Number(base.timestampHeader);
    expect(
      verifyWebhookSignature({ ...base, nowSeconds: ts + WEBHOOK_TOLERANCE_SECONDS + 1 }),
    ).toBe(false);
    expect(verifyWebhookSignature({ ...base, nowSeconds: ts + WEBHOOK_TOLERANCE_SECONDS })).toBe(
      true,
    );
  });

  it('signs with both keys during rotation and ignores unknown signature versions', async () => {
    const { notifier, sent } = make({ previousSecret: OLD_SECRET });
    await notifier.notify(EVENT);
    const h = sent[0]?.headers ?? {};
    const header = h[WEBHOOK_HEADERS.signature] ?? '';
    expect(header.split(',')).toHaveLength(2);
    const base = {
      timestampHeader: h[WEBHOOK_HEADERS.timestamp] ?? '',
      signatureHeader: header,
      rawBody: sent[0]?.body ?? '',
    };
    expect(verifyWebhookSignature({ ...base, secrets: [SECRET] })).toBe(true);
    expect(verifyWebhookSignature({ ...base, secrets: [OLD_SECRET] })).toBe(true);
    const forged = (header.split(',')[0] ?? '').replace('v1=', 'v2=');
    expect(verifyWebhookSignature({ ...base, secrets: [SECRET], signatureHeader: forged })).toBe(
      false,
    );
  });

  it('retries 5xx with the documented backoff and re-signs each attempt', async () => {
    const sleeps: number[] = [];
    let t = 1_700_000_000_000;
    const { notifier, sent } = make({
      transport: statuses(503, 502, 200),
      sleep: (ms) => {
        sleeps.push(ms);
        t += ms;
        return Promise.resolve();
      },
      now: () => t,
    });
    await expect(notifier.notify(EVENT)).resolves.toEqual({ status: 200, attempts: 3 });
    expect(sleeps).toEqual([1000, 4000]);
    const stamps = sent.map((r) => r.headers[WEBHOOK_HEADERS.timestamp]);
    expect(new Set(stamps).size).toBe(3);
    const sigs = sent.map((r) => r.headers[WEBHOOK_HEADERS.signature]);
    expect(new Set(sigs).size).toBe(3);
    expect(sent.every((r) => r.headers[WEBHOOK_HEADERS.idempotencyKey] === EVENT.id)).toBe(true);
  });

  it('gives up after 3 attempts with a retryable error', async () => {
    const { notifier, sent } = make({ transport: statuses(500) });
    const err = await failure(notifier.notify(EVENT));
    expect(err.code).toBe('unavailable');
    expect(err.retryable).toBe(true);
    expect(sent).toHaveLength(3);
  });

  it('maps 429 to throttled (retried) and 408 to timeout (retried)', async () => {
    const a = make({ transport: statuses(429) });
    expect((await failure(a.notifier.notify(EVENT))).code).toBe('throttled');
    expect(a.sent).toHaveLength(3);
    const b = make({ transport: statuses(408) });
    expect((await failure(b.notifier.notify(EVENT))).code).toBe('timeout');
    expect(b.sent).toHaveLength(3);
  });

  it('does not retry other 4xx (rejected)', async () => {
    const { notifier, sent } = make({ transport: statuses(400) });
    const err = await failure(notifier.notify(EVENT));
    expect(err.code).toBe('rejected');
    expect(err.retryable).toBe(false);
    expect(sent).toHaveLength(1);
  });

  it('stops retrying when the call deadline cannot cover the next wait', async () => {
    let t = 0;
    const { notifier, sent } = make({
      transport: statuses(500),
      now: () => t,
      sleep: (ms) => {
        t += ms;
        return Promise.resolve();
      },
    });
    const err = await failure(notifier.notify(EVENT, { timeoutMs: 3000 }));
    expect(err.code).toBe('unavailable');
    expect(sent).toHaveLength(2);
  });

  it('retry policy cannot be changed at runtime', () => {
    expect(WEBHOOK_RETRY_POLICY.maxAttempts).toBe(3);
    expect([...WEBHOOK_RETRY_POLICY.backoffMs]).toEqual([1000, 4000]);
    expect(Object.isFrozen(WEBHOOK_RETRY_POLICY)).toBe(true);
    expect(Object.isFrozen(WEBHOOK_RETRY_POLICY.backoffMs)).toBe(true);
    expect(() => {
      (WEBHOOK_RETRY_POLICY.backoffMs as number[]).push(1);
    }).toThrow();
  });

  it('rejects malformed events before any attempt', async () => {
    const { notifier, sent } = make();
    const bad = { ...EVENT, id: 'x\r\nX-Evil: 1' };
    expect((await failure(notifier.notify(bad))).code).toBe('invalid_input');
    expect(sent).toHaveLength(0);
  });
});

describe('mock-webhook: configuration', () => {
  it('factory builds from env and requires url and a strong secret', () => {
    expect(factory.name).toBe('mock-webhook');
    expect(factory.env.map((e) => e.name)).toEqual([
      'WEBHOOK_URL',
      'WEBHOOK_SECRET',
      'WEBHOOK_SECRET_PREVIOUS',
    ]);
    expect(factory.env.every((e) => e.secret)).toBe(true);
    expect(factory.create({ WEBHOOK_URL: URL_WITH_TOKEN, WEBHOOK_SECRET: SECRET }).name).toBe(
      'mock-webhook',
    );
    for (const env of [
      {},
      { WEBHOOK_URL: URL_WITH_TOKEN },
      { WEBHOOK_URL: URL_WITH_TOKEN, WEBHOOK_SECRET: 'short' },
      { WEBHOOK_URL: URL_WITH_TOKEN, WEBHOOK_SECRET: SECRET, WEBHOOK_SECRET_PREVIOUS: 'short' },
    ]) {
      expect(() => factory.create(env)).toThrowError(
        expect.objectContaining({ code: 'misconfigured' }) as Error,
      );
    }
  });

  it('error messages never contain the secret or the URL', () => {
    try {
      createMockWebhookNotifier({ url: URL_WITH_TOKEN, secret: 'short-secret-value' });
    } catch (e) {
      const text = JSON.stringify(e) + String((e as Error).message);
      expect(text).not.toContain('short-secret-value');
      expect(text).not.toContain('SUPER-SECRET-TOKEN');
      return;
    }
    throw new Error('expected throw');
  });
});

// One test per SSRF rule in the `webhook.ts` contract header (THREAT-MODEL T14, issue #49 note).
describe('mock-webhook SSRF rules', () => {
  it('rule: https only (http, ftp, userinfo and garbage are refused as misconfigured)', () => {
    for (const url of [
      'http://hooks.example.se/in',
      'ftp://hooks.example.se/in',
      'https://user:pw@hooks.example.se/in',
      'not a url',
      '',
    ]) {
      const err = (() => {
        try {
          createMockWebhookNotifier({ url, secret: SECRET });
        } catch (e) {
          return e as AdapterError;
        }
        return undefined;
      })();
      expect(err).toBeInstanceOf(AdapterError);
      expect(err?.code).toBe('misconfigured');
    }
    expect(() =>
      createMockWebhookNotifier({ url: 'https://hooks.example.se/in', secret: SECRET }),
    ).not.toThrow();
  });

  it('rule: no redirects (3xx is rejected, not followed, and not retried)', async () => {
    const { notifier, sent } = make({ transport: statuses(301) });
    const err = await failure(notifier.notify(EVENT));
    expect(err.code).toBe('rejected');
    expect(sent).toHaveLength(1);
    expect(sent[0]?.followRedirects).toBe(false);
  });

  describe('rule: refuse each blocked range', () => {
    const blocked: [string, string][] = [
      ['loopback v4', '127.0.0.1'],
      ['loopback v4 other', '127.255.255.254'],
      ['private 10/8', '10.1.2.3'],
      ['private 172.16/12 low', '172.16.0.1'],
      ['private 172.16/12 high', '172.31.255.255'],
      ['private 192.168/16', '192.168.1.1'],
      ['link-local', '169.254.10.10'],
      ['cloud metadata', '169.254.169.254'],
      ['CGNAT low', '100.64.0.1'],
      ['CGNAT high', '100.127.255.254'],
      ['multicast v4', '224.0.0.1'],
      ['unspecified v4', '0.0.0.0'],
      ['loopback v6', '::1'],
      ['unspecified v6', '::'],
      ['link-local v6', 'fe80::1'],
      ['unique-local fc', 'fc00::1'],
      ['unique-local fd', 'fd12:3456::1'],
      ['multicast v6', 'ff02::1'],
    ];
    it.each(blocked)('%s (%s)', async (_label, address) => {
      const { notifier, sent } = make({ resolve: () => Promise.resolve([address]) });
      const err = await failure(notifier.notify(EVENT));
      expect(err.code).toBe('misconfigured');
      expect(err.retryable).toBe(false);
      expect(sent).toHaveLength(0);
    });
  });

  describe('rule: refuse the IPv4-mapped IPv6 forms of each blocked range', () => {
    const mapped: [string, string][] = [
      ['mapped loopback dotted', '::ffff:127.0.0.1'],
      ['mapped loopback hex', '::ffff:7f00:1'],
      ['mapped loopback long form', '0:0:0:0:0:ffff:127.0.0.1'],
      ['mapped 10/8', '::ffff:10.0.0.1'],
      ['mapped 172.16/12', '::ffff:172.16.0.1'],
      ['mapped 192.168/16', '::ffff:192.168.0.1'],
      ['mapped metadata dotted', '::ffff:169.254.169.254'],
      ['mapped metadata hex', '::ffff:a9fe:a9fe'],
      ['mapped CGNAT', '::ffff:100.64.0.1'],
      ['mapped multicast', '::ffff:224.0.0.1'],
      ['mapped unspecified', '::ffff:0.0.0.0'],
    ];
    it.each(mapped)('%s (%s)', async (_label, address) => {
      const { notifier, sent } = make({ resolve: () => Promise.resolve([address]) });
      const err = await failure(notifier.notify(EVENT));
      expect(err.code).toBe('misconfigured');
      expect(sent).toHaveLength(0);
    });
  });

  it('rule: refuse when ANY resolved address is blocked, even if another is public', async () => {
    const { notifier, sent } = make({
      resolve: () => Promise.resolve(['203.0.113.7', '10.0.0.5']),
    });
    expect((await failure(notifier.notify(EVENT))).code).toBe('misconfigured');
    expect(sent).toHaveLength(0);
  });

  it('rule: an IP literal in the URL is vetted too', async () => {
    const { notifier, sent } = make({ url: 'https://[::ffff:7f00:1]/in' });
    expect((await failure(notifier.notify(EVENT))).code).toBe('misconfigured');
    const dec = make({ url: 'https://2130706433/in' }); // URL parser turns this into 127.0.0.1
    expect((await failure(dec.notifier.notify(EVENT))).code).toBe('misconfigured');
    expect(sent).toHaveLength(0);
    expect(dec.sent).toHaveLength(0);
  });

  it('rule: public addresses, including public mapped IPv6, are allowed', async () => {
    for (const address of ['203.0.113.7', '8.8.8.8', '2606:4700::1111', '::ffff:8.8.8.8']) {
      const { notifier, sent } = make({ resolve: () => Promise.resolve([address]) });
      await expect(notifier.notify(EVENT)).resolves.toMatchObject({ status: 200 });
      expect(sent).toHaveLength(1);
    }
  });

  it('rule: connect to the vetted IP, keep the host for SNI and Host, no second lookup', async () => {
    const lookups: string[] = [];
    const answers = [['203.0.113.7'], ['127.0.0.1']]; // a rebinding attacker flips the second answer
    const { notifier, sent } = make({
      url: 'https://hooks.example.se:8443/in?x=1',
      resolve: (h) => {
        lookups.push(h);
        return Promise.resolve(answers.shift() ?? ['127.0.0.1']);
      },
    });
    await notifier.notify(EVENT);
    expect(lookups).toEqual(['hooks.example.se']);
    expect(sent[0]?.ip).toBe('203.0.113.7');
    expect(sent[0]?.hostname).toBe('hooks.example.se');
    expect(sent[0]?.port).toBe(8443);
    expect(sent[0]?.path).toBe('/in?x=1');
  });

  it('rule: per-attempt timeout (a hanging attempt is aborted and reported as timeout)', async () => {
    const signals: AbortSignal[] = [];
    const hang: WebhookTransport = {
      send: (req) => {
        signals.push(req.signal);
        return new Promise<WebhookTransportResponse>(() => undefined); // never answers
      },
    };
    const { notifier } = make({ transport: hang, attemptTimeoutMs: 15 });
    const err = await failure(notifier.notify(EVENT, { timeoutMs: 60_000 }));
    expect(err.code).toBe('timeout');
    expect(err.retryable).toBe(true);
    expect(signals).toHaveLength(3);
    expect(signals.every((s) => s.aborted)).toBe(true);
  });

  it('rule: read at most 4 KiB of the response body, then close it', async () => {
    let pulled = 0;
    let closed = false;
    const chunk = new Uint8Array(1024);
    const body: AsyncIterable<Uint8Array> = {
      [Symbol.asyncIterator]() {
        return {
          next: () => {
            pulled += chunk.byteLength;
            return Promise.resolve({ done: false as const, value: chunk });
          },
          return: () => {
            closed = true;
            return Promise.resolve({ done: true as const, value: undefined });
          },
        };
      },
    };
    const { notifier, sent } = make({
      transport: { send: () => Promise.resolve({ status: 200, body }) },
    });
    await notifier.notify(EVENT);
    expect(WEBHOOK_MAX_RESPONSE_BYTES).toBe(4096);
    expect(sent[0]?.maxResponseBytes).toBe(4096);
    expect(pulled).toBe(4096);
    expect(closed).toBe(true);
  });

  it('rule: the response body is never logged or put in an error', async () => {
    const logs: unknown[] = [];
    const secretBody = new TextEncoder().encode('LEAKED-RESPONSE-BODY');
    const body: AsyncIterable<Uint8Array> = {
      async *[Symbol.asyncIterator]() {
        await Promise.resolve();
        yield secretBody;
      },
    };
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation((...a: unknown[]) => {
        logs.push(a);
      }),
    );
    const { notifier } = make({
      transport: { send: () => Promise.resolve({ status: 500, body }) },
      logger: { info: (e) => logs.push(e) },
    });
    const err = await failure(notifier.notify(EVENT));
    spies.forEach((s) => {
      s.mockRestore();
    });
    const everything = JSON.stringify([logs, err.message, err.cause, { ...err }]);
    expect(everything).not.toContain('LEAKED-RESPONSE-BODY');
    expect(everything).not.toContain('Anna Andersson'); // event.data is not logged either
    expect(everything).not.toContain('SUPER-SECRET-TOKEN');
    expect(everything).not.toContain(SECRET);
    expect(logs).toEqual([{ id: EVENT.id, type: EVENT.type, status: 0, attempts: 3 }]);
  });

  it('rule: a refusal is `misconfigured` and its message has no URL or address', async () => {
    const { notifier } = make({ resolve: () => Promise.resolve(['169.254.169.254']) });
    const err = await failure(notifier.notify(EVENT));
    expect(err.code).toBe('misconfigured');
    const text = `${err.message} ${JSON.stringify({ ...err })} ${String(err.cause)}`;
    expect(text).not.toContain('169.254');
    expect(text).not.toContain('hooks.example.se');
    expect(text).not.toContain('SUPER-SECRET-TOKEN');
    expect(text).not.toContain('https://');
  });

  it('transport errors that embed the URL are replaced, not chained', async () => {
    const { notifier } = make({
      transport: {
        send: () => Promise.reject(new Error(`connect ECONNREFUSED ${URL_WITH_TOKEN}`)),
      },
    });
    const err = await failure(notifier.notify(EVENT));
    expect(err.code).toBe('unavailable');
    expect(err.cause).toBeUndefined();
    expect(err.message).not.toContain('SUPER-SECRET-TOKEN');
  });
});
