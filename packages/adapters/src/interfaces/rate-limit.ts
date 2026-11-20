/**
 * Rate-limit store contract (DECISIONS #37). Functions call `hit` before doing any work for a
 * request; the store is pluggable because counters must live wherever the hosting provider
 * offers shared state. Owner: architect.
 *
 * PII: none by design. Keys are opaque hashes built by the caller (see {@link RateLimitKey});
 * a store never receives an IP address, email or other raw identifier.
 */

import type { AdapterCallOptions } from './index.js';

/** Closed set of rate-limit store names (= folder names). Moves to `@pwp/schema/adapters` in #64. */
export const RATE_LIMIT_ADAPTER_NAMES = ['memory-rate-limit'] as const;
export type RateLimitAdapterName = (typeof RATE_LIMIT_ADAPTER_NAMES)[number];

/**
 * Opaque key `<scope>:<digest>`. `scope` is a short constant (`[a-z0-9-]{1,32}`, e.g.
 * `contact-ip`); `digest` is lowercase hex HMAC-SHA256 of the raw identifier with a per-tenant
 * secret, computed by the request-hardening layer (#50). The brand makes "pass a raw IP" a
 * type error; only #50 casts to it.
 */
export type RateLimitKey = string & { readonly __brand: 'RateLimitKey' };

/** Allow at most `limit` hits per `windowSeconds`. Both positive integers. */
export interface RateLimitWindow {
  readonly limit: number;
  readonly windowSeconds: number;
}

export interface RateLimitResult {
  /** `true` if this hit is within the limit. A rejected hit still counts. */
  readonly allowed: boolean;
  /** Hits left in the current window after this one (0 when not allowed). */
  readonly remaining: number;
  /** Seconds until a hit would be allowed again; 0 when `allowed`. Use for `Retry-After`. */
  readonly retryAfterSeconds: number;
}

/**
 * Records one hit for `key` and tells whether it is within `window`.
 *
 * - Atomic per key: concurrent hits never both see the last free slot.
 * - Sliding or fixed window is the store's choice, but it must never allow more than
 *   `2 × limit` hits in any `windowSeconds` span.
 * - Keys expire on their own; a store keeps no data longer than `windowSeconds` after the last hit.
 * - Rejects only with `AdapterError` (`timeout`, `unavailable`, `misconfigured`). Callers
 *   **fail closed**: if the store errors, the request is refused (#50).
 */
export interface RateLimitStore {
  readonly name: RateLimitAdapterName;
  hit(
    key: RateLimitKey,
    window: RateLimitWindow,
    options?: AdapterCallOptions,
  ): Promise<RateLimitResult>;
}
