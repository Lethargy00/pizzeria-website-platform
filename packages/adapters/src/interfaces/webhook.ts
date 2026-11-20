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
 * | `X-PWP-Event`           | `event.type`                                                     |
 * | `X-PWP-Idempotency-Key` | `event.id` (identical on every retry of the same event)          |
 * | `X-PWP-Timestamp`       | Unix time in **seconds** when this attempt was signed            |
 * | `X-PWP-Signature`       | `v1=<hex>`; during secret rotation `v1=<hex>,v1=<hex>`           |
 *
 * `<hex>` = lowercase hex of HMAC-SHA256(key = `WEBHOOK_SECRET` as UTF-8 bytes,
 * message = {@link webhookSigningInput}(timestamp, rawBody)), where `rawBody` is the exact UTF-8
 * request body. Each retry is re-signed with a fresh timestamp.
 *
 * Receivers must: recompute the HMAC over the raw body before parsing JSON; compare in constant
 * time against every `v1=` entry; reject when `|now - timestamp| > WEBHOOK_TOLERANCE_SECONDS`;
 * de-duplicate on `X-PWP-Idempotency-Key`.
 */

import type { AdapterCallOptions } from './index.js';

/** Closed set of webhook adapter names (= folder names). Moves to `@pwp/schema/adapters` in #64. */
export const WEBHOOK_ADAPTER_NAMES = ['mock-webhook'] as const;
export type WebhookAdapterName = (typeof WEBHOOK_ADAPTER_NAMES)[number];

/** Env vars shared by every webhook adapter. */
export const WEBHOOK_ENV = {
  /** Target URL, `https:` only. **Secret** (URLs often embed tokens). Required. */
  url: 'WEBHOOK_URL',
  /** HMAC key, at least 32 random bytes encoded as 64+ hex chars or 43+ base64url chars. **Secret**. Required. */
  secret: 'WEBHOOK_SECRET',
  /** Optional second key, signed in addition during rotation. **Secret**. */
  previousSecret: 'WEBHOOK_SECRET_PREVIOUS',
} as const;

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
  /** Tenant slug. */
  readonly tenant: string;
  /** Location id within the tenant, when the form is per location. */
  readonly location?: string;
  /** ISO 8601 UTC timestamp of the submission (not of the delivery attempt). */
  readonly occurredAt: string;
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
 * - Rejects only with `AdapterError`: `misconfigured` (no or non-https URL, weak secret),
 *   `rejected` (`4xx` other than 408/429), `throttled` (429), `timeout`, `unavailable` (`5xx`,
 *   network). Redirects are not followed (`rejected`).
 * - Never logs `event.data`, the URL or the secret. Logs at most `id`, `type`, status, attempts.
 */
export interface WebhookNotifier {
  readonly name: WebhookAdapterName;
  notify(event: WebhookEvent, options?: AdapterCallOptions): Promise<WebhookDeliveryResult>;
}
