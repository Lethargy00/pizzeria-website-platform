/**
 * In-memory sliding-window rate-limit store (ADR 0001, #49). Default in dev and tests; also fine
 * for a single long-lived process. State is per process, so it is NOT shared between serverless
 * instances: production needs a store backed by shared state.
 *
 * Algorithm: a log of hit times per key (sliding window log), so it never allows more than
 * `limit` hits in any `windowSeconds` span (stricter than the contract's `2 x limit`).
 * - A rejected hit still counts. At most `limit + 1` times are kept per key (the newest ones),
 *   which gives the same decisions as keeping them all, and bounds memory per key. `limit` is
 *   capped at {@link MAX_LIMIT}, so a caller cannot make one key arbitrarily large.
 * - Keys are dropped once their last hit is older than the window. The number of live keys is
 *   capped; when the cap is reached with no expired key to drop, `hit` rejects with
 *   `unavailable` (callers fail closed, #50) rather than evicting a live key, which would let
 *   an attacker reset their own counter by flooding other keys.
 * - Fails closed on a bad clock: a `now()` result that is not a finite, non-negative number
 *   rejects with `unavailable` and records nothing (#159). Bad key or window types reject with
 *   `invalid_input` before the clock is read.
 * - Tolerates a clock that steps backwards (e.g. an NTP step): `times` stays sorted and
 *   `expiresAt` never moves earlier (except for the #189 cap below, which only applies to a step
 *   of more than one window), so a key's counter is never reset early (#174).
 * - Bounds how far ahead of the clock an entry can reach. Suppose the clock jumps far forward
 *   and then comes back. Every hit logged during the jump would be in the future, and the
 *   key could stay in the store for the length of the jump. A large jump could then fill the
 *   store. So when an entry is read or swept at `t`, a logged hit later than `t + windowMs` is
 *   capped at `t + windowMs`, and `expiresAt` at `t + 2 * windowMs` (`windowMs` is the largest
 *   window the key has used). A capped hit still counts for at least a full window from now,
 *   and it really happened before now, so the counter is never reset early (fails closed). A
 *   backwards step of up to one window is not changed. After any jump, a key leaves the store
 *   within two of its largest windows of real time (so at most two days), counted from the
 *   first call after the clock comes back. `windowMs` is updated with the current hit's
 *   window before the cap runs, so that window counts too (#189).
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
/** Upper bound for `RateLimitWindow.limit`. Memory per key is `limit + 1` timestamps. */
export const MAX_LIMIT = 10_000;
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
  /** Largest window (ms) this key has been hit with. Bounds how far ahead it can reach (#189). */
  windowMs: number;
}

function misconfigured(message: string): AdapterError {
  return new AdapterError('rateLimit', NAME, 'misconfigured', message);
}

function invalidInput(message: string): AdapterError {
  return new AdapterError('rateLimit', NAME, 'invalid_input', message);
}

export function createMemoryRateLimitStore(
  options: MemoryRateLimitOptions = {},
): MemoryRateLimitStore {
  const now = options.now ?? (() => Date.now());
  const maxKeys = options.maxKeys ?? DEFAULT_MAX_KEYS;
  if (!Number.isSafeInteger(maxKeys) || maxKeys < 1) throw misconfigured('maxKeys must be >= 1');
  const entries = new Map<string, Entry>();

  /**
   * Caps an entry that reaches too far ahead of `t` (#189). An entry that only took a backwards
   * step of up to one window is left exactly as it is (#174).
   */
  function normalize(e: Entry, t: number): void {
    const maxTime = t + e.windowMs;
    if (e.expiresAt <= maxTime + e.windowMs) return;
    // `times` stays ascending: the capped values are the last ones and are all equal.
    e.times = e.times.map((x) => Math.min(x, maxTime));
    e.expiresAt = maxTime + e.windowMs;
  }

  function sweep(t: number): void {
    for (const [k, e] of entries) {
      normalize(e, t);
      if (e.expiresAt <= t) entries.delete(k);
    }
  }

  function decide(key: unknown, window: unknown): RateLimitResult {
    // Type checks come first, so a non-string key or a non-object window is `invalid_input`
    // (not retryable) instead of a TypeError that would surface as `unavailable` (#159).
    if (typeof key !== 'string' || !KEY_RE.test(key)) throw invalidInput('invalid rate-limit key');
    if (typeof window !== 'object' || window === null) throw invalidInput('invalid window');
    const { limit, windowSeconds } = window as Partial<RateLimitWindow>;
    if (
      typeof limit !== 'number' ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > MAX_LIMIT
    ) {
      throw invalidInput('invalid limit');
    }
    if (
      typeof windowSeconds !== 'number' ||
      !Number.isSafeInteger(windowSeconds) ||
      windowSeconds < 1 ||
      windowSeconds > MAX_WINDOW_SECONDS
    ) {
      throw invalidInput('invalid window');
    }
    const t = now();
    // A NaN/Infinity clock makes every logged hit look outside the window, which would allow
    // every hit (fail open). Reject before any entry is created or changed (#159).
    if (typeof t !== 'number' || !Number.isFinite(t) || t < 0) {
      throw new AdapterError('rateLimit', NAME, 'unavailable', 'rate-limit clock failure');
    }
    const windowMs = windowSeconds * 1000;

    let entry = entries.get(key);
    if (entry === undefined) {
      if (entries.size >= maxKeys) sweep(t);
      if (entries.size >= maxKeys) {
        throw new AdapterError('rateLimit', NAME, 'unavailable', 'rate-limit store is full');
      }
      entry = { times: [], expiresAt: 0, windowMs };
      entries.set(key, entry);
    }
    entry.windowMs = Math.max(entry.windowMs, windowMs);
    normalize(entry, t);
    // Drop hits that left the window (a hit exactly one window old has left it).
    // After a backwards clock step a logged hit can be later than `t`; it is still in the window
    // (fails closed) until the clock passes it by a full window (#174).
    const live = entry.times.filter((x) => t - x < windowMs);
    const priorHits = live.length;
    // Insert in order, so `times` stays ascending even after a backwards step. Then the trim
    // below keeps the hits that leave the window last, and the pivot below is right (#174).
    let at = live.length;
    while (at > 0 && (live[at - 1] ?? 0) > t) at--;
    live.splice(at, 0, t);
    // Keep the newest limit + 1: older ones can never change a decision.
    entry.times = live.length > limit + 1 ? live.slice(live.length - (limit + 1)) : live;
    // Monotonic: a backwards clock step (or a shorter window on a later call) must never move
    // the expiry earlier, or `sweep` could drop a live key and reset its counter (#174).
    entry.expiresAt = Math.max(entry.expiresAt, t + windowMs);

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
        if (e instanceof AdapterError) return Promise.reject(e);
        // Anything else (e.g. a throwing injected clock) becomes a fixed, PII-free error with no
        // `cause`, so the contract's "rejects only with AdapterError" holds (#142).
        return Promise.reject(
          new AdapterError('rateLimit', NAME, 'unavailable', 'rate-limit store failure'),
        );
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
