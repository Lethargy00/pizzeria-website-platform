/**
 * In-memory sliding-window rate-limit store (ADR 0001, #49). Default in dev and tests; also fine
 * for a single long-lived process. State is per process, so it is NOT shared between serverless
 * instances: production needs a store backed by shared state.
 *
 * Algorithm: a log of hit times per key (sliding window log), so it never allows more than
 * `limit` hits in any `windowSeconds` span (stricter than the contract's `2 x limit`).
 * - A rejected hit still counts. At most `limit + 1` times are kept per key (the newest ones),
 *   which gives the same decisions as keeping them all, and bounds memory per key.
 * - Keys are dropped once their last hit is older than the window. The number of live keys is
 *   capped; when the cap is reached with no expired key to drop, `hit` rejects with
 *   `unavailable` (callers fail closed, #50) rather than evicting a live key, which would let
 *   an attacker reset their own counter by flooding other keys.
 * - JavaScript is single-threaded and `hit` has no `await` between read and write, so it is
 *   atomic per key.
 */

import { AdapterError } from '../interfaces/index.js';
import type {
  AdapterFactory,
  RateLimitKey,
  RateLimitResult,
  RateLimitStore,
  RateLimitWindow,
} from '../interfaces/index.js';

const NAME = 'memory-rate-limit' as const;
const KEY_RE = /^[a-z0-9-]{1,32}:[0-9a-f]{32,128}$/;
const MAX_WINDOW_SECONDS = 86_400;
export const DEFAULT_MAX_KEYS = 10_000;

export interface MemoryRateLimitOptions {
  /** Clock in milliseconds. Tests inject a fake one. */
  readonly now?: () => number;
  /** Maximum number of live keys. Default {@link DEFAULT_MAX_KEYS}. */
  readonly maxKeys?: number;
}

export interface MemoryRateLimitStore extends RateLimitStore {
  /** Number of keys currently held (for tests and diagnostics). */
  readonly size: number;
  reset(): void;
}

interface Entry {
  /** Ascending hit times (ms). */
  times: number[];
  /** Time (ms) after which the whole entry can be dropped. */
  expiresAt: number;
}

function misconfigured(message: string): AdapterError {
  return new AdapterError('rateLimit', NAME, 'misconfigured', message);
}

export function createMemoryRateLimitStore(
  options: MemoryRateLimitOptions = {},
): MemoryRateLimitStore {
  const now = options.now ?? (() => Date.now());
  const maxKeys = options.maxKeys ?? DEFAULT_MAX_KEYS;
  if (!Number.isSafeInteger(maxKeys) || maxKeys < 1) throw misconfigured('maxKeys must be >= 1');
  const entries = new Map<string, Entry>();

  function sweep(t: number): void {
    for (const [k, e] of entries) if (e.expiresAt <= t) entries.delete(k);
  }

  function decide(key: RateLimitKey, window: RateLimitWindow): RateLimitResult {
    if (!KEY_RE.test(key)) throw misconfigured('invalid rate-limit key');
    const { limit, windowSeconds } = window;
    if (!Number.isSafeInteger(limit) || limit < 1) throw misconfigured('invalid limit');
    if (
      !Number.isSafeInteger(windowSeconds) ||
      windowSeconds < 1 ||
      windowSeconds > MAX_WINDOW_SECONDS
    ) {
      throw misconfigured('invalid window');
    }
    const t = now();
    const windowMs = windowSeconds * 1000;

    let entry = entries.get(key);
    if (entry === undefined) {
      if (entries.size >= maxKeys) sweep(t);
      if (entries.size >= maxKeys) {
        throw new AdapterError('rateLimit', NAME, 'unavailable', 'rate-limit store is full');
      }
      entry = { times: [], expiresAt: 0 };
      entries.set(key, entry);
    }
    // Drop hits that left the window (a hit exactly one window old has left it).
    const live = entry.times.filter((x) => t - x < windowMs);
    const priorHits = live.length;
    live.push(t);
    // Keep the newest limit + 1: older ones can never change a decision.
    entry.times = live.length > limit + 1 ? live.slice(live.length - (limit + 1)) : live;
    entry.expiresAt = t + windowMs;

    if (priorHits < limit) {
      return { allowed: true, remaining: limit - priorHits - 1, retryAfterSeconds: 0 };
    }
    // Blocked. The next hit is allowed once fewer than `limit` logged hits are still in the
    // window; that happens when the hit at index (length - limit) has left it.
    const pivot = entry.times[entry.times.length - limit] ?? t;
    const retryAfterSeconds = Math.max(1, Math.ceil((pivot + windowMs - t) / 1000));
    return { allowed: false, remaining: 0, retryAfterSeconds };
  }

  return {
    name: NAME,
    get size() {
      return entries.size;
    },
    reset() {
      entries.clear();
    },
    hit(key: RateLimitKey, window: RateLimitWindow): Promise<RateLimitResult> {
      try {
        return Promise.resolve(decide(key, window));
      } catch (e) {
        return Promise.reject(e instanceof Error ? e : misconfigured('rate-limit failure'));
      }
    },
  };
}

/** `AdapterFactory` for site config discovery. Reads no env vars. */
export const factory: AdapterFactory<'rateLimit', RateLimitStore> = {
  kind: 'rateLimit',
  name: NAME,
  env: [],
  create(): RateLimitStore {
    return createMemoryRateLimitStore();
  },
};
