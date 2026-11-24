import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdapterError } from '../interfaces/index.js';
import type { RateLimitKey } from '../interfaces/index.js';
import { MAX_LIMIT, createMemoryRateLimitStore, factory } from './index.js';

const key = (scope: string, n = 1): RateLimitKey =>
  `${scope}:${n.toString(16).padStart(64, '0')}` as RateLimitKey;
const W = { limit: 3, windowSeconds: 60 };

function clock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    advance(ms: number) {
      t += ms;
    },
  };
}

describe('memory-rate-limit', () => {
  it('allows up to the limit, then rejects, counting remaining', async () => {
    const c = clock();
    const s = createMemoryRateLimitStore({ now: c.now });
    const r = [];
    for (let i = 0; i < 5; i++) r.push(await s.hit(key('contact-ip'), W));
    expect(r.map((x) => x.allowed)).toEqual([true, true, true, false, false]);
    expect(r.map((x) => x.remaining)).toEqual([2, 1, 0, 0, 0]);
    expect(r[0]?.retryAfterSeconds).toBe(0);
    expect(r[3]?.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('is a true sliding window: never more than limit hits in any window span', async () => {
    const c = clock();
    const s = createMemoryRateLimitStore({ now: c.now });
    const k = key('contact-ip');
    await s.hit(k, W); // t=0
    c.advance(30_000);
    await s.hit(k, W); // t=30
    await s.hit(k, W); // t=30
    c.advance(30_000); // t=60: first hit just left the window, one slot free
    expect((await s.hit(k, W)).allowed).toBe(true);
    expect((await s.hit(k, W)).allowed).toBe(false);
  });

  it('a hit exactly one window old no longer counts', async () => {
    const c = clock();
    const s = createMemoryRateLimitStore({ now: c.now });
    const k = key('a');
    const w = { limit: 1, windowSeconds: 10 };
    expect((await s.hit(k, w)).allowed).toBe(true);
    c.advance(9_999);
    expect((await s.hit(k, w)).allowed).toBe(false);
  });

  it('a rejected hit still counts (hammering keeps you blocked)', async () => {
    const c = clock();
    const s = createMemoryRateLimitStore({ now: c.now });
    const k = key('a');
    const w = { limit: 1, windowSeconds: 10 };
    expect((await s.hit(k, w)).allowed).toBe(true); // t=0
    c.advance(6_000);
    expect((await s.hit(k, w)).allowed).toBe(false); // t=6, counts
    c.advance(5_000); // t=11: the t=0 hit left, the t=6 hit is still in
    expect((await s.hit(k, w)).allowed).toBe(false); // t=11, counts
    c.advance(5_000); // t=16: the t=6 hit left; the t=11 hit is still in
    expect((await s.hit(k, w)).allowed).toBe(false);
    c.advance(10_000); // quiet for a full window
    expect((await s.hit(k, w)).allowed).toBe(true);
  });

  it('retryAfterSeconds tells when the next hit would be allowed', async () => {
    const c = clock();
    const s = createMemoryRateLimitStore({ now: c.now });
    const k = key('a');
    await s.hit(k, W); // t=0
    c.advance(10_000);
    await s.hit(k, W); // t=10
    await s.hit(k, W); // t=10
    c.advance(5_000); // t=15
    const blocked = await s.hit(k, W); // counts as a 4th hit
    expect(blocked).toEqual({ allowed: false, remaining: 0, retryAfterSeconds: 55 });
    c.advance(54_000); // t=69: one second early, the t=10 hits are still in
    expect((await s.hit(k, W)).allowed).toBe(false);
  });

  it('keys are independent', async () => {
    const c = clock();
    const s = createMemoryRateLimitStore({ now: c.now });
    const w = { limit: 1, windowSeconds: 60 };
    expect((await s.hit(key('a', 1), w)).allowed).toBe(true);
    expect((await s.hit(key('a', 1), w)).allowed).toBe(false);
    expect((await s.hit(key('a', 2), w)).allowed).toBe(true);
    expect((await s.hit(key('b', 1), w)).allowed).toBe(true);
  });

  it('is atomic: concurrent hits never share the last slot', async () => {
    const s = createMemoryRateLimitStore();
    const w = { limit: 5, windowSeconds: 60 };
    const res = await Promise.all(Array.from({ length: 50 }, () => s.hit(key('a'), w)));
    expect(res.filter((r) => r.allowed)).toHaveLength(5);
  });

  it('keeps no data after the window and bounds memory per key', async () => {
    const c = clock();
    const s = createMemoryRateLimitStore({ now: c.now, maxKeys: 2 });
    const w = { limit: 2, windowSeconds: 10 };
    for (let i = 0; i < 1000; i++) await s.hit(key('a', 1), w);
    await s.hit(key('a', 2), w);
    expect(s.size).toBe(2);
    c.advance(10_000);
    // expired keys are swept when room is needed
    await s.hit(key('a', 3), w);
    expect(s.size).toBe(1);
  });

  it('fails closed when full of live keys instead of evicting one', async () => {
    const c = clock();
    const s = createMemoryRateLimitStore({ now: c.now, maxKeys: 2 });
    const w = { limit: 1, windowSeconds: 60 };
    await s.hit(key('a', 1), w);
    await s.hit(key('a', 2), w);
    await expect(s.hit(key('a', 3), w)).rejects.toMatchObject({ code: 'unavailable' });
    // existing keys keep their counters
    expect((await s.hit(key('a', 1), w)).allowed).toBe(false);
  });

  it('rejects raw identifiers and bad windows as invalid_input', async () => {
    const s = createMemoryRateLimitStore();
    const raw = '203.0.113.7' as RateLimitKey;
    await expect(s.hit(raw, W)).rejects.toBeInstanceOf(AdapterError);
    await expect(s.hit(raw, W)).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(s.hit(key('a'), { limit: 0, windowSeconds: 60 })).rejects.toMatchObject({
      code: 'invalid_input',
    });
    await expect(s.hit(key('a'), { limit: 1, windowSeconds: 1.5 })).rejects.toMatchObject({
      code: 'invalid_input',
    });
    await expect(s.hit(key('a'), { limit: 1, windowSeconds: 0 })).rejects.toMatchObject({
      code: 'invalid_input',
    });
    await expect(s.hit(key('a'), { limit: 1.5, windowSeconds: 60 })).rejects.toMatchObject({
      code: 'invalid_input',
    });
    await expect(s.hit(key('a'), { limit: -1, windowSeconds: 60 })).rejects.toMatchObject({
      code: 'invalid_input',
    });
    await expect(s.hit(key('a'), { limit: Number.NaN, windowSeconds: 60 })).rejects.toMatchObject({
      code: 'invalid_input',
    });
    await expect(s.hit(key('a'), { limit: 1, windowSeconds: 86_401 })).rejects.toMatchObject({
      code: 'invalid_input',
    });
    await expect(s.hit(key('a'), { limit: 1, windowSeconds: -60 })).rejects.toMatchObject({
      code: 'invalid_input',
    });
    // bad input records nothing
    expect(s.size).toBe(0);
  });

  it('bad input rejects with a non-retryable AdapterError (#142)', async () => {
    const s = createMemoryRateLimitStore();
    const e: unknown = await s.hit('bad' as RateLimitKey, W).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(AdapterError);
    expect(e).toMatchObject({ code: 'invalid_input', retryable: false, kind: 'rateLimit' });
  });

  it('a bad maxKeys at construction stays misconfigured (#142)', () => {
    for (const maxKeys of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      let caught: unknown;
      try {
        createMemoryRateLimitStore({ maxKeys });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(AdapterError);
      expect(caught).toMatchObject({ code: 'misconfigured' });
    }
  });

  it('wraps an Error thrown by now() as unavailable with no cause (#142)', async () => {
    const secret = 'clock broke for 203.0.113.7';
    const s = createMemoryRateLimitStore({
      now: () => {
        throw new RangeError(secret);
      },
    });
    const e: unknown = await s.hit(key('a'), W).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(AdapterError);
    expect(e).not.toBeInstanceOf(RangeError);
    expect(e).toMatchObject({ code: 'unavailable', kind: 'rateLimit' });
    expect((e as Error).cause).toBeUndefined();
    expect((e as Error).message).not.toContain('203.0.113.7');
  });

  it('wraps a non-Error thrown by now() as unavailable with no cause (#142)', async () => {
    const s = createMemoryRateLimitStore({
      now: () => {
        throw 'boom';
      },
    });
    const e: unknown = await s.hit(key('a'), W).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(AdapterError);
    expect(e).toMatchObject({ code: 'unavailable' });
    expect((e as Error).cause).toBeUndefined();
  });

  it('passes its own AdapterError through unchanged (#142)', async () => {
    const s = createMemoryRateLimitStore({ maxKeys: 1 });
    await s.hit(key('a', 1), W);
    await expect(s.hit(key('a', 2), W)).rejects.toMatchObject({
      code: 'unavailable',
      message: 'rate-limit store is full',
    });
  });

  it('caps RateLimitWindow.limit at MAX_LIMIT (#100)', async () => {
    const s = createMemoryRateLimitStore();
    await expect(
      s.hit(key('a'), { limit: MAX_LIMIT + 1, windowSeconds: 60 }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(
      s.hit(key('a'), { limit: Number.MAX_SAFE_INTEGER, windowSeconds: 60 }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    expect((await s.hit(key('a'), { limit: MAX_LIMIT, windowSeconds: 60 })).allowed).toBe(true);
  });

  it('rejects over-long keys (#100)', async () => {
    const s = createMemoryRateLimitStore();
    const long = `a:${'0'.repeat(129)}` as RateLimitKey;
    await expect(s.hit(long, W)).rejects.toMatchObject({ code: 'invalid_input' });
    const longScope = `${'a'.repeat(33)}:${'0'.repeat(64)}` as RateLimitKey;
    await expect(s.hit(longScope, W)).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('error messages never echo the key', async () => {
    const s = createMemoryRateLimitStore();
    try {
      await s.hit('203.0.113.7' as RateLimitKey, W);
    } catch (e) {
      expect((e as Error).message).not.toContain('203.0.113.7');
      return;
    }
    throw new Error('expected rejection');
  });

  describe('a clock that returns a bad value fails closed (#159)', () => {
    const bad: readonly [string, number][] = [
      ['NaN', Number.NaN],
      ['Infinity', Number.POSITIVE_INFINITY],
      ['-Infinity', Number.NEGATIVE_INFINITY],
      ['negative', -1],
    ];
    for (const [label, value] of bad) {
      it(`now() = ${label}: never allows, records nothing, fixed message, no cause`, async () => {
        const s = createMemoryRateLimitStore({ now: () => value });
        const w = { limit: 1, windowSeconds: 60 };
        for (let i = 0; i < 5; i++) {
          const e: unknown = await s.hit(key('a'), w).then(
            () => undefined,
            (x: unknown) => x,
          );
          expect(e).toBeInstanceOf(AdapterError);
          expect(e).toMatchObject({
            code: 'unavailable',
            kind: 'rateLimit',
            message: 'rate-limit clock failure',
          });
          expect((e as Error).cause).toBeUndefined();
        }
        expect(s.size).toBe(0);
      });
    }

    it('a non-number now() result fails closed the same way', async () => {
      const s = createMemoryRateLimitStore({ now: () => '1000' as unknown as number });
      await expect(s.hit(key('a'), W)).rejects.toMatchObject({
        code: 'unavailable',
        message: 'rate-limit clock failure',
      });
      expect(s.size).toBe(0);
    });

    it('a bad tick does not disturb an existing counter', async () => {
      let t = 1_000_000;
      const s = createMemoryRateLimitStore({ now: () => t });
      const w = { limit: 1, windowSeconds: 60 };
      expect((await s.hit(key('a'), w)).allowed).toBe(true);
      t = Number.NaN;
      await expect(s.hit(key('a'), w)).rejects.toMatchObject({ code: 'unavailable' });
      t = 1_000_001;
      expect((await s.hit(key('a'), w)).allowed).toBe(false);
      expect(s.size).toBe(1);
    });

    it('now() = 0 is a valid time', async () => {
      const s = createMemoryRateLimitStore({ now: () => 0 });
      expect((await s.hit(key('a'), W)).allowed).toBe(true);
    });
  });

  describe('bad key and window types reject as invalid_input (#159)', () => {
    const badKeys: readonly [string, unknown][] = [
      ['null', null],
      ['undefined', undefined],
      ['number', 42],
      ['object', {}],
      [
        'object whose toString throws',
        {
          toString() {
            throw new Error('203.0.113.7');
          },
        },
      ],
      ['String object', new String(`a:${'0'.repeat(64)}`)],
    ];
    for (const [label, k] of badKeys) {
      it(`key = ${label}`, async () => {
        let clockRead = false;
        const s = createMemoryRateLimitStore({
          now: () => {
            clockRead = true;
            return 0;
          },
        });
        const e: unknown = await s.hit(k as RateLimitKey, W).catch((x: unknown) => x);
        expect(e).toBeInstanceOf(AdapterError);
        expect(e).toMatchObject({
          code: 'invalid_input',
          retryable: false,
          message: 'invalid rate-limit key',
        });
        expect((e as Error).message).not.toContain('203.0.113.7');
        expect((e as Error).cause).toBeUndefined();
        expect(clockRead).toBe(false);
        expect(s.size).toBe(0);
      });
    }

    const badWindows: readonly [string, unknown][] = [
      ['null', null],
      ['undefined', undefined],
      ['number', 60],
      ['string', '60'],
      ['empty object', {}],
      ['array', [1, 60]],
      ['string fields', { limit: '1', windowSeconds: '60' }],
    ];
    for (const [label, w] of badWindows) {
      it(`window = ${label}`, async () => {
        let clockRead = false;
        const s = createMemoryRateLimitStore({
          now: () => {
            clockRead = true;
            return 0;
          },
        });
        const e: unknown = await s
          .hit(key('a'), w as { limit: number; windowSeconds: number })
          .catch((x: unknown) => x);
        expect(e).toBeInstanceOf(AdapterError);
        expect(e).toMatchObject({ code: 'invalid_input', retryable: false, kind: 'rateLimit' });
        expect((e as Error).cause).toBeUndefined();
        expect(clockRead).toBe(false);
        expect(s.size).toBe(0);
      });
    }

    it('key type is checked before the window', async () => {
      const s = createMemoryRateLimitStore();
      await expect(
        s.hit(null as unknown as RateLimitKey, null as unknown as typeof W),
      ).rejects.toMatchObject({ code: 'invalid_input', message: 'invalid rate-limit key' });
    });
  });

  describe('a clock that steps backwards keeps the counter (#174)', () => {
    const w = { limit: 1, windowSeconds: 60 };

    it('sweep does not evict a live key after a backwards step', async () => {
      const c = clock(); // T
      const s = createMemoryRateLimitStore({ now: c.now, maxKeys: 2 });
      expect((await s.hit(key('a'), w)).allowed).toBe(true); // a hit at T, live until T+60
      c.advance(-50_000); // NTP step to T-50
      expect((await s.hit(key('a'), w)).allowed).toBe(false);
      expect((await s.hit(key('b'), w)).allowed).toBe(true); // b expires at T+10; store full
      c.advance(70_000); // T+20: b has expired, a has not
      expect((await s.hit(key('c'), w)).allowed).toBe(true); // sweep drops b only
      expect(s.size).toBe(2);
      expect((await s.hit(key('a'), w)).allowed).toBe(false);
    });

    it('stays blocked until the original window ends, through sweeps', async () => {
      const c = clock(); // T
      const s = createMemoryRateLimitStore({ now: c.now, maxKeys: 2 });
      expect((await s.hit(key('a'), w)).allowed).toBe(true); // window ends at T+60
      c.advance(-30_000); // T-30
      expect((await s.hit(key('a'), w)).allowed).toBe(false);
      // No more hits on `a`, so nothing refreshes its expiry. New keys on a full store run
      // sweep at T-20 ... T+50 and at T+59.999, which must keep `a` every time.
      for (let i = 1; i <= 8; i++) {
        c.advance(10_000);
        await s.hit(key('x', i), w).catch(() => undefined);
      }
      c.advance(9_999); // T+59.999
      await s.hit(key('x', 9), w).catch(() => undefined);
      expect((await s.hit(key('a'), w)).allowed).toBe(false);
    });

    it('retryAfterSeconds stays correct after the step', async () => {
      const c = clock(); // T
      const s = createMemoryRateLimitStore({ now: c.now });
      const k = key('a');
      expect((await s.hit(k, w)).allowed).toBe(true); // T
      expect((await s.hit(k, w)).allowed).toBe(false); // T (counts)
      c.advance(-30_000); // T-30: the T hits leave the window at T+60, 90 s from now
      const blocked = await s.hit(k, w);
      expect(blocked).toMatchObject({ allowed: false, retryAfterSeconds: 90 });
      c.advance(89_999); // T+59.999: still blocked, and the advice still holds
      expect(await s.hit(k, w)).toMatchObject({ allowed: false, retryAfterSeconds: 60 });
    });

    it('a forward clock keeps times sorted: the trim keeps the newest hits', async () => {
      const c = clock();
      const s = createMemoryRateLimitStore({ now: c.now });
      const k = key('a');
      expect((await s.hit(k, w)).allowed).toBe(true); // t=0
      c.advance(10_000);
      expect((await s.hit(k, w)).allowed).toBe(false); // t=10
      c.advance(10_000);
      // t=20: the t=0 hit is trimmed; the t=20 hit is the last to leave, at t=80.
      expect(await s.hit(k, w)).toMatchObject({ allowed: false, retryAfterSeconds: 60 });
    });

    it('a later hit with a shorter window does not shorten the expiry', async () => {
      const c = clock();
      const s = createMemoryRateLimitStore({ now: c.now, maxKeys: 1 });
      expect((await s.hit(key('a'), { limit: 1, windowSeconds: 600 })).allowed).toBe(true);
      expect((await s.hit(key('a'), { limit: 1, windowSeconds: 1 })).allowed).toBe(false);
      c.advance(2_000);
      // The 600 s hit is still live, so sweep must not free the slot.
      await expect(s.hit(key('b'), w)).rejects.toMatchObject({ code: 'unavailable' });
      expect((await s.hit(key('a'), { limit: 1, windowSeconds: 600 })).allowed).toBe(false);
    });
  });

  describe('a large forward clock jump and return does not fill the store (#189)', () => {
    // These use vitest fake timers and the store's default clock (`Date.now`).
    const T0 = new Date('2026-03-29T00:30:00Z').getTime();
    const DAY = 86_400_000;
    const w = { limit: 1, windowSeconds: 60 };

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(T0);
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('frees the store within two windows after the clock comes back', async () => {
      const s = createMemoryRateLimitStore({ maxKeys: 3 });
      vi.setSystemTime(T0 + DAY); // the clock jumps a day ahead
      for (let i = 1; i <= 3; i++) expect((await s.hit(key('j', i), w)).allowed).toBe(true);
      await expect(s.hit(key('n', 1), w)).rejects.toMatchObject({ code: 'unavailable' });
      vi.setSystemTime(T0 + 1_000); // and comes back
      // Still full, and fails closed: the hits from the jump still count for a while.
      await expect(s.hit(key('n', 1), w)).rejects.toMatchObject({ code: 'unavailable' });
      vi.advanceTimersByTime(120_000); // two windows of real time, not a day
      expect((await s.hit(key('n', 1), w)).allowed).toBe(true);
      expect(s.size).toBe(1);
      for (let i = 2; i <= 3; i++) expect((await s.hit(key('n', i), w)).allowed).toBe(true);
    });

    it('memory stays bounded across repeated jumps', async () => {
      const s = createMemoryRateLimitStore({ maxKeys: 5 });
      let n = 0;
      for (let round = 0; round < 10; round++) {
        const base = T0 + round * 200_000;
        vi.setSystemTime(base + DAY);
        for (let i = 0; i < 5; i++) await s.hit(key('j', ++n), w).catch(() => undefined);
        vi.setSystemTime(base);
        // The first call after the return is when the store sees the clock come back.
        await expect(s.hit(key('p', round + 1), w)).rejects.toMatchObject({
          code: 'unavailable',
        });
        expect(s.size).toBeLessThanOrEqual(5);
        vi.advanceTimersByTime(120_000);
        expect((await s.hit(key('n', round + 1), w)).allowed).toBe(true);
        expect(s.size).toBeLessThanOrEqual(5);
      }
    });

    it('keys hit during the jump stay blocked for a full window after the return', async () => {
      const s = createMemoryRateLimitStore();
      const k = key('a');
      vi.setSystemTime(T0 + DAY);
      expect((await s.hit(k, w)).allowed).toBe(true);
      vi.setSystemTime(T0);
      // Capped at one window ahead, so blocked for two windows from now and never reset early.
      expect(await s.hit(k, w)).toMatchObject({ allowed: false, retryAfterSeconds: 120 });
      vi.advanceTimersByTime(119_999);
      expect((await s.hit(k, w)).allowed).toBe(false);
      // That blocked hit counts too, so the key frees one window after it.
      vi.advanceTimersByTime(60_001);
      expect((await s.hit(k, w)).allowed).toBe(true);
    });

    it('a step back of exactly one window is not capped (#174 behaviour)', async () => {
      const s = createMemoryRateLimitStore();
      const k = key('a');
      expect((await s.hit(k, w)).allowed).toBe(true); // T0, leaves at T0+60
      vi.setSystemTime(T0 - 60_000);
      expect(await s.hit(k, w)).toMatchObject({ allowed: false, retryAfterSeconds: 120 });
      vi.advanceTimersByTime(119_999);
      expect((await s.hit(k, w)).allowed).toBe(false);
    });

    it('a step back of more than one window is capped at one window ahead', async () => {
      const s = createMemoryRateLimitStore({ maxKeys: 1 });
      const k = key('a');
      expect((await s.hit(k, w)).allowed).toBe(true); // T0
      vi.setSystemTime(T0 - 10 * 60_000); // 10 min back
      // Without the cap this would be 660 s; capped, the T0 hit counts as now + 60 s.
      expect(await s.hit(k, w)).toMatchObject({ allowed: false, retryAfterSeconds: 120 });
      vi.advanceTimersByTime(119_999);
      expect((await s.hit(k, w)).allowed).toBe(false);
    });

    it('sweep caps an entry that is never hit again', async () => {
      const s = createMemoryRateLimitStore({ maxKeys: 1 });
      vi.setSystemTime(T0 + DAY);
      expect((await s.hit(key('a'), w)).allowed).toBe(true);
      vi.setSystemTime(T0);
      await expect(s.hit(key('b'), w)).rejects.toMatchObject({ code: 'unavailable' });
      vi.advanceTimersByTime(119_999); // capped expiry is T0+120
      await expect(s.hit(key('b'), w)).rejects.toMatchObject({ code: 'unavailable' });
      vi.advanceTimersByTime(1);
      expect((await s.hit(key('b'), w)).allowed).toBe(true);
      expect(s.size).toBe(1);
    });

    it('caps by the largest window a key has used, not the latest one', async () => {
      const s = createMemoryRateLimitStore({ maxKeys: 1 });
      const long = { limit: 1, windowSeconds: 600 };
      vi.setSystemTime(T0 + 300_000);
      expect((await s.hit(key('a'), long)).allowed).toBe(true);
      expect((await s.hit(key('a'), w)).allowed).toBe(false);
      vi.setSystemTime(T0); // 5 min back: within the 600 s window, so nothing is capped
      vi.advanceTimersByTime(599_000); // T0+599: the hit is live until T0+900
      await expect(s.hit(key('b'), w)).rejects.toMatchObject({ code: 'unavailable' });
      expect((await s.hit(key('a'), long)).allowed).toBe(false);
    });

    it('caps by the largest window when a short window came first (fails closed)', async () => {
      // Without tracking the largest window, `a` would be capped by its first (60 s) window and
      // evicted after 120 s while its 600 s hit is still live, resetting its counter early.
      const s = createMemoryRateLimitStore({ maxKeys: 1 });
      const short = { limit: 5, windowSeconds: 60 };
      const long = { limit: 1, windowSeconds: 600 };
      vi.setSystemTime(T0 + DAY);
      expect((await s.hit(key('a'), short)).allowed).toBe(true);
      expect((await s.hit(key('a'), long)).allowed).toBe(false);
      vi.setSystemTime(T0);
      await expect(s.hit(key('b'), short)).rejects.toMatchObject({ code: 'unavailable' });
      vi.advanceTimersByTime(130_000);
      await expect(s.hit(key('b'), short)).rejects.toMatchObject({ code: 'unavailable' });
      expect((await s.hit(key('a'), long)).allowed).toBe(false);
    });

    it("the current hit's window counts before the cap runs", async () => {
      const s = createMemoryRateLimitStore();
      vi.setSystemTime(T0 + DAY);
      expect((await s.hit(key('a'), w)).allowed).toBe(true);
      vi.setSystemTime(T0);
      // Capped by 600 s (not the stored 60 s): the jump hit counts as T0+600, left at T0+1200.
      expect(await s.hit(key('a'), { limit: 1, windowSeconds: 600 })).toMatchObject({
        allowed: false,
        retryAfterSeconds: 1_200,
      });
    });

    it('a step back of one window + 1 ms is capped at t+2W, not later', async () => {
      const s = createMemoryRateLimitStore();
      const k = key('a');
      expect((await s.hit(k, w)).allowed).toBe(true); // T0
      vi.setSystemTime(T0 - 60_001);
      // Uncapped it would be 120.001 s (121). Capped: the T0 hit counts as now + 60 s.
      expect(await s.hit(k, w)).toMatchObject({ allowed: false, retryAfterSeconds: 120 });
    });

    it('a step back of less than one window does not extend the expiry (#174)', async () => {
      const s = createMemoryRateLimitStore({ maxKeys: 1 });
      expect((await s.hit(key('a'), w)).allowed).toBe(true); // T0, expires at T0+60
      vi.setSystemTime(T0 - 30_000);
      await expect(s.hit(key('b'), w)).rejects.toMatchObject({ code: 'unavailable' });
      vi.setSystemTime(T0 + 60_000);
      expect((await s.hit(key('b'), w)).allowed).toBe(true);
      expect(s.size).toBe(1);
    });

    it('normal forward time still works, across a DST change', async () => {
      // 2026-03-29 01:00 UTC is the EU spring-forward. Date.now() is UTC, so it is no jump.
      const s = createMemoryRateLimitStore({ maxKeys: 2 });
      const k = key('a');
      const r = { limit: 2, windowSeconds: 3_600 };
      expect((await s.hit(k, r)).allowed).toBe(true); // 00:30Z
      vi.advanceTimersByTime(30 * 60_000); // 01:00Z
      expect((await s.hit(k, r)).allowed).toBe(true);
      // Blocked, and this hit counts too, so two 01:00 hits hold the key until 02:00.
      expect(await s.hit(k, r)).toMatchObject({ allowed: false, retryAfterSeconds: 3_600 });
      vi.advanceTimersByTime(30 * 60_000); // 01:30Z: the 00:30 hit left; 01:00 pair still in
      expect((await s.hit(k, r)).allowed).toBe(false);
      vi.advanceTimersByTime(3_600_000);
      expect((await s.hit(k, r)).allowed).toBe(true);
      expect((await s.hit(key('b'), r)).allowed).toBe(true);
      expect(s.size).toBe(2);
    });

    it('a forward jump with no return still drops expired keys', async () => {
      const s = createMemoryRateLimitStore({ maxKeys: 2 });
      await s.hit(key('a', 1), w);
      await s.hit(key('a', 2), w);
      vi.setSystemTime(T0 + DAY);
      expect((await s.hit(key('a', 3), w)).allowed).toBe(true);
      expect(s.size).toBe(1);
    });
  });

  it('factory declares no env vars and builds a store', () => {
    expect(factory.name).toBe('memory-rate-limit');
    expect(factory.env).toEqual([]);
    expect(factory.create({}).name).toBe('memory-rate-limit');
  });
});
