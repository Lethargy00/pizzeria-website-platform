/**
 * Generic outgoing webhook contract (DECISIONS #42). Lets a pizzeria receive form submissions in
 * its own system (POS, chat, spreadsheet automation). Owner: architect; signing scheme reviewed by
 * security.
 *
 * PII: `event.data` may contain personal data (`@pii`). Everything else in the envelope is not PII.
 *
 * ## Signing scheme (v1)
 *
 * Every delivery is an HTTPS `POST` with `Content-Type: application/json; charset=utf-8` and:
 *
 * | Header                  | Value                                                            |
 * | ----------------------- | ---------------------------------------------------------------- |
 * | `X-PWP-Event`           | `event.type`; **unsigned, informational only** (see below)       |
 * | `X-PWP-Idempotency-Key` | `event.id` (identical on every retry of the same event)          |
 * | `X-PWP-Timestamp`       | Unix time in **seconds** when this attempt was signed            |
 * | `X-PWP-Signature`       | `v1=<hex>`; during secret rotation `v1=<hex>,v1=<hex>`           |
 *
 * `<hex>` = lowercase hex of HMAC-SHA256(key = `WEBHOOK_SECRET` as UTF-8 bytes,
 * message = {@link webhookSigningInput}(timestamp, rawBody)), where `rawBody` is the exact UTF-8
 * request body. Each retry is re-signed with a fresh timestamp.
 *
 * Receivers must:
 * - recompute the HMAC over the raw body before parsing JSON;
 * - route on the **signed body's** `type` field only. `X-PWP-Event` is not covered by the
 *   signature, so an attacker who replays a captured body can set it to anything; it is a hint
 *   for logs and proxies, never input to a routing or authorisation decision;
 * - compare in constant time against every `v1=` entry, **ignore entries with an unknown
 *   version** (never treat them as valid), and reject when no `v1=` entry matches;
 * - reject when `|now - timestamp| > WEBHOOK_TOLERANCE_SECONDS`;
 * - de-duplicate on `X-PWP-Idempotency-Key`, keeping seen keys for **at least**
 *   `WEBHOOK_TOLERANCE_SECONDS` (24 h recommended, to also cover retries). Inside the tolerance
 *   window a captured request replays with a valid signature, so this is the replay defence.
 *
 * ## SSRF duties of every sending adapter (THREAT-MODEL T14)
 *
 * `WEBHOOK_URL` is tenant-configured, so a real adapter must:
 * - accept `https:` only, and follow no redirects;
 * - resolve the host and **refuse** the delivery unless **every** resolved address is global
 *   unicast. This is an allow-list, not a denylist (#100):
 *   - IPv4 is allowed unless it is in an IANA IPv4 special-purpose range that is not globally
 *     reachable. That covers `0/8`, `10/8`, `100.64/10`, `127/8`, `169.254/16` (incl.
 *     `169.254.169.254` cloud metadata), `172.16/12`, `192.0.0/24`, `192.0.2/24`,
 *     `192.88.99/24`, `192.168/16`, `198.18/15`, `198.51.100/24` and `203.0.113/24`. Multicast
 *     `224/4` and reserved `240/4` are refused as well.
 *   - IPv6 is allowed only inside `2000::/3`, minus `2001::/23` (incl. Teredo `2001::/32`),
 *     `2001:db8::/32`, `2002::/16` (6to4) and `3fff::/20`. Outside `2000::/3`, only IPv4-mapped
 *     `::ffff:0:0/96` and well-known NAT64 `64:ff9b::/96` are accepted, and only when the
 *     embedded IPv4 address is allowed. Everything else is refused, including loopback,
 *     unspecified, `fc00::/7`, `fe80::/10`, multicast, IPv4-translated `::ffff:0:0:0/96`,
 *     IPv4-compatible `::/96`, local-use NAT64 `64:ff9b:1::/48` and discard `100::/64`.
 *   - Unparseable addresses are refused.
 *
 *   Refusal is `AdapterError` code `misconfigured`, and its message does not contain the URL or
 *   the address;
 * - **connect to the vetted IP** (keeping the original host for TLS SNI and `Host`), so DNS
 *   rebinding can't swap the address between the check and the connect;
 * - apply a timeout to **each attempt**, as well as the overall `AdapterCallOptions.timeoutMs`;
 * - read at most a small capped prefix of the response body (≤ 4 KiB), only to drain the
 *   connection. It is never logged, put into an error `message` or `cause`, or returned.
 */

import type { IsoDateTime, Slug } from '@pwp/schema/primitives';
import type { WebhookAdapterName } from '@pwp/schema/adapters';
import type { AdapterCallOptions, AdapterEnvVarName } from './index.js';

/** Closed set of webhook adapter names (= folder names). Canonical in `@pwp/schema/adapters` (#64). */
export { WEBHOOK_ADAPTER_NAMES, type WebhookAdapterName } from '@pwp/schema/adapters';

/** Env vars shared by every webhook adapter. */
export const WEBHOOK_ENV = {
  /** Target URL, `https:` only. **Secret** (URLs often embed tokens). Required. */
  url: 'WEBHOOK_URL',
  /** HMAC key, at least 32 random bytes encoded as 64+ hex chars or 43+ base64url chars. **Secret**. Required. */
  secret: 'WEBHOOK_SECRET',
  /** Optional second key, signed in addition during rotation. **Secret**. */
  previousSecret: 'WEBHOOK_SECRET_PREVIOUS',
} as const satisfies Record<string, AdapterEnvVarName<'webhook'>>;

export const WEBHOOK_HEADERS = {
  event: 'X-PWP-Event',
  idempotencyKey: 'X-PWP-Idempotency-Key',
  timestamp: 'X-PWP-Timestamp',
  signature: 'X-PWP-Signature',
} as const;

export const WEBHOOK_SIGNATURE_VERSION = 'v1';

/** Maximum allowed clock difference, in seconds, between signer and receiver. */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

/**
 * The exact string that is HMAC'd: `"<timestamp>.<rawBody>"`.
 * Shared so that signer (#49) and receiver docs/tests can never drift.
 */
export function webhookSigningInput(timestampSeconds: number, rawBody: string): string {
  if (!Number.isSafeInteger(timestampSeconds) || timestampSeconds < 0) {
    throw new RangeError('timestamp must be a non-negative integer number of seconds');
  }
  return `${String(timestampSeconds)}.${rawBody}`;
}

/** Closed set of events in v1. Ordering/payment events do not exist (DECISIONS #32, #33). */
export type WebhookEventType = 'contact.submitted' | 'catering.requested' | 'reservation.requested';

/** JSON-safe field value of a submitted form. */
export type WebhookFieldValue = string | number | boolean | null | readonly string[];

/**
 * The JSON body of one delivery. Serialised once with `JSON.stringify`; the same bytes are signed
 * and sent.
 */
export interface WebhookEvent {
  /** Unique event id (UUID v4); also the idempotency key. */
  readonly id: string;
  readonly type: WebhookEventType;
  /** Tenant slug (`@pwp/schema` `Slug`). */
  readonly tenant: Slug;
  /** Location id within the tenant, when the form is per location. */
  readonly location?: string;
  /**
   * When the form was submitted (not when this delivery attempt was made), as a UTC
   * `IsoDateTime` (#145): `YYYY-MM-DDTHH:mm:ss.sssZ` from `Date#toISOString()`, or without the
   * millisecond part. Never an offset or a local time.
   */
  readonly occurredAt: IsoDateTime;
  /** Schema version of `data`, bumped on breaking changes to the form payloads. */
  readonly version: 1;
  /**
   * @pii The validated form fields, keyed by field name. Already validated by the form's schema
   * (M7). Tightened to per-event types once the form schemas are contracts.
   */
  readonly data: Readonly<Record<string, WebhookFieldValue>>;
}

export interface WebhookDeliveryResult {
  /** HTTP status of the final attempt. `2xx` means delivered. */
  readonly status: number;
  /** Attempts made inside this call (1 when delivered first time). */
  readonly attempts: number;
}

/**
 * Delivers one event to the tenant's webhook URL.
 *
 * - Resolves when the receiver answered `2xx`.
 * - Rejects only with `AdapterError`: `misconfigured` (no or non-https URL, weak secret, or a
 *   resolved address refused by the SSRF rules in this file's header), `rejected` (`4xx` other
 *   than 408/429), `throttled` (429), `timeout` (HTTP 408, or no answer in time), `unavailable`
 *   (`5xx`, network). Redirects are not followed (`rejected`).
 * - Never logs `event.data`, the URL or the secret. Logs at most `id`, `type`, status, attempts.
 */
export interface WebhookNotifier {
  readonly name: WebhookAdapterName;
  notify(event: WebhookEvent, options?: AdapterCallOptions): Promise<WebhookDeliveryResult>;
}
