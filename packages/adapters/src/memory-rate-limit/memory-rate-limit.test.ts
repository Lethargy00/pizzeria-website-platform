import { describe, expect, it } from 'vitest';
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

  it('factory declares no env vars and builds a store', () => {
    expect(factory.name).toBe('memory-rate-limit');
    expect(factory.env).toEqual([]);
    expect(factory.create({}).name).toBe('memory-rate-limit');
  });
});
