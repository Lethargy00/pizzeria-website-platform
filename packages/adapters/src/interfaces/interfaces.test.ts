import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  ADAPTER_NAMES,
  AdapterError,
  WEBHOOK_TOLERANCE_SECONDS,
  webhookSigningInput,
} from './index.js';
import type {
  AdapterFactory,
  AdapterName,
  AdapterSelection,
  EmailMessage,
  EmailSender,
  RateLimitKey,
  RateLimitStore,
  WebhookEvent,
  WebhookNotifier,
} from './index.js';

describe('adapter contracts', () => {
  it('adapter names are a closed union', () => {
    expectTypeOf<AdapterName>().toEqualTypeOf<
      'mock-email' | 'mock-webhook' | 'memory-rate-limit'
    >();
    expect(ADAPTER_NAMES).toEqual({
      email: ['mock-email'],
      webhook: ['mock-webhook'],
      rateLimit: ['memory-rate-limit'],
    });
    // @ts-expect-error unknown adapter names are rejected
    const bad: AdapterSelection = { rateLimit: 'redis' };
    void bad;
  });

  it('selection requires a rate-limit store, email and webhook are optional', () => {
    const ok: AdapterSelection = { rateLimit: 'memory-rate-limit' };
    void ok;
    // @ts-expect-error rateLimit is required
    const missing: AdapterSelection = { email: 'mock-email' };
    void missing;
  });

  it('email messages have no sender and no HTML body', () => {
    expectTypeOf<EmailMessage>().not.toHaveProperty('from');
    expectTypeOf<EmailMessage>().not.toHaveProperty('html');
    // @ts-expect-error at least one recipient
    const noRecipient: EmailMessage['to'] = [];
    void noRecipient;
  });

  it('rate-limit keys cannot be raw strings', () => {
    const store = null as unknown as RateLimitStore;
    // @ts-expect-error a raw IP is not a RateLimitKey
    void (() => store.hit('203.0.113.7', { limit: 5, windowSeconds: 60 }));
    expectTypeOf<RateLimitStore['hit']>().parameter(0).toEqualTypeOf<RateLimitKey>();
  });

  it('factories bind kind, name and adapter type together', () => {
    expectTypeOf<AdapterFactory<'email', EmailSender>['name']>().toEqualTypeOf<'mock-email'>();
    expectTypeOf<WebhookNotifier['notify']>().parameter(0).toEqualTypeOf<WebhookEvent>();
  });

  it('AdapterError derives retryable from its code', () => {
    const e = new AdapterError('webhook', 'mock-webhook', 'timeout', 'webhook timed out');
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('AdapterError');
    expect(e.retryable).toBe(true);
    expect(new AdapterError('email', 'mock-email', 'rejected', 'x').retryable).toBe(false);
  });

  it('webhook signing input is "<timestamp>.<rawBody>"', () => {
    expect(webhookSigningInput(1_763_640_000, '{"a":1}')).toBe('1763640000.{"a":1}');
    expect(() => webhookSigningInput(1.5, '')).toThrow(RangeError);
    expect(() => webhookSigningInput(-1, '')).toThrow(RangeError);
    expect(WEBHOOK_TOLERANCE_SECONDS).toBe(300);
  });
});
