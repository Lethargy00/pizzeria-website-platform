import { describe, expect, expectTypeOf, it } from 'vitest';
import * as schemaAdapters from '@pwp/schema/adapters';
import type { Email, LocaleCode, Slug } from '@pwp/schema/primitives';
import * as interfaces from './index.js';
import {
  ADAPTER_ENV_PREFIX,
  ADAPTER_NAMES,
  EMAIL_ADAPTER_NAMES,
  EMAIL_ENV,
  RATE_LIMIT_ADAPTER_NAMES,
  WEBHOOK_ADAPTER_NAMES,
  WEBHOOK_ENV,
  AdapterError,
  RETRYABLE_ADAPTER_ERROR_CODES,
  WEBHOOK_TOLERANCE_SECONDS,
  webhookSigningInput,
} from './index.js';
import type {
  AdapterEnvVar,
  AdapterEnvVarName,
  AdapterFactory,
  AdapterKind,
  AdapterName,
  AdapterNameByKind,
  AdapterSelection,
  EmailAdapterName,
  EmailAddress,
  EmailMessage,
  RateLimitAdapterName,
  EmailSender,
  RateLimitKey,
  RateLimitStore,
  WebhookAdapterName,
  WebhookEvent,
  WebhookNotifier,
} from './index.js';

describe('adapter names come from @pwp/schema/adapters (#82)', () => {
  it('re-exports the same name tuples, not copies', () => {
    expect(EMAIL_ADAPTER_NAMES).toBe(schemaAdapters.EMAIL_ADAPTER_NAMES);
    expect(WEBHOOK_ADAPTER_NAMES).toBe(schemaAdapters.WEBHOOK_ADAPTER_NAMES);
    expect(RATE_LIMIT_ADAPTER_NAMES).toBe(schemaAdapters.RATE_LIMIT_ADAPTER_NAMES);
    expect(ADAPTER_NAMES).toBe(schemaAdapters.ADAPTER_NAMES);
  });

  it('has the same name and selection types as the schema', () => {
    expectTypeOf<EmailAdapterName>().toEqualTypeOf<schemaAdapters.EmailAdapterName>();
    expectTypeOf<WebhookAdapterName>().toEqualTypeOf<schemaAdapters.WebhookAdapterName>();
    expectTypeOf<RateLimitAdapterName>().toEqualTypeOf<schemaAdapters.RateLimitAdapterName>();
    expectTypeOf<AdapterKind>().toEqualTypeOf<schemaAdapters.AdapterKind>();
    expectTypeOf<AdapterNameByKind>().toEqualTypeOf<schemaAdapters.AdapterNameByKind>();
    expectTypeOf<AdapterName>().toEqualTypeOf<schemaAdapters.AdapterName>();
    expectTypeOf<AdapterSelection>().toEqualTypeOf<schemaAdapters.AdapterSelection>();
  });

  it('re-exports names as types only, and no Zod schemas or production data', () => {
    for (const key of [
      'EmailAdapterName',
      'WebhookAdapterName',
      'RateLimitAdapterName',
      'AdapterSelection',
      'ADAPTER_KINDS',
      'ADAPTER_PRODUCTION_SUPPORT',
      'ADAPTER_PRODUCTION_SUPPORTS',
    ]) {
      expect(interfaces).not.toHaveProperty(key);
    }
  });

  it('selection is the inferred schema type: mutable, optional keys accept undefined', () => {
    const sel: AdapterSelection = { email: undefined, rateLimit: 'memory-rate-limit' };
    sel.rateLimit = 'memory-rate-limit';
    const frozen: Readonly<AdapterSelection> = sel;
    // @ts-expect-error callers that want immutability use Readonly<>
    frozen.rateLimit = 'memory-rate-limit';
  });
});

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
    expectTypeOf<AdapterFactory<'email', EmailSender>['env']>().toEqualTypeOf<
      readonly AdapterEnvVar<'email'>[]
    >();
    expectTypeOf<WebhookNotifier['notify']>().parameter(0).toEqualTypeOf<WebhookEvent>();
    // Production fitness lives only in @pwp/schema/adapters (ADAPTER_PRODUCTION_SUPPORT).
    expectTypeOf<keyof AdapterFactory<'email', EmailSender>>().toEqualTypeOf<
      'kind' | 'name' | 'env' | 'create'
    >();
    const sender = null as unknown as EmailSender;
    const wrongName: AdapterFactory<'email', EmailSender> = {
      kind: 'email',
      // @ts-expect-error a webhook name on an email factory
      name: 'mock-webhook',
      env: [],
      create: () => sender,
    };
    void wrongName;
  });

  it('AdapterError ties the adapter name to its kind', () => {
    const e = new AdapterError('email', 'mock-email', 'rejected', 'x');
    expectTypeOf(e.kind).toEqualTypeOf<'email'>();
    expectTypeOf(e.adapter).toEqualTypeOf<'mock-email'>();
    // @ts-expect-error a webhook adapter name with the email kind
    void new AdapterError('email', 'mock-webhook', 'rejected', 'x');
    // @ts-expect-error an email adapter name with the rate-limit kind
    void new AdapterError('rateLimit', 'mock-email', 'timeout', 'x');
    const any: AdapterError = e;
    expectTypeOf(any.kind).toEqualTypeOf<AdapterKind>();
    expectTypeOf(any.adapter).toEqualTypeOf<AdapterName>();
  });

  it('env var names must carry the kind prefix', () => {
    expectTypeOf<'EMAIL_FROM'>().toExtend<AdapterEnvVarName<'email'>>();
    expectTypeOf<'RATE_LIMIT_URL'>().toExtend<AdapterEnvVarName<'rateLimit'>>();
    expectTypeOf<'WEBHOOK_URL'>().not.toExtend<AdapterEnvVarName<'email'>>();
    expectTypeOf<'FROM'>().not.toExtend<AdapterEnvVarName<'email'>>();
    expectTypeOf<'EMAIL_from'>().not.toExtend<AdapterEnvVarName<'email'>>();
    expectTypeOf<typeof EMAIL_ENV.from>().toExtend<AdapterEnvVarName<'email'>>();
    expectTypeOf<typeof WEBHOOK_ENV.secret>().toExtend<AdapterEnvVarName<'webhook'>>();
    for (const name of Object.values(EMAIL_ENV)) expect(name).toMatch(/^EMAIL_[A-Z0-9_]+$/);
    for (const name of Object.values(WEBHOOK_ENV)) expect(name).toMatch(/^WEBHOOK_[A-Z0-9_]+$/);
    expect(ADAPTER_ENV_PREFIX).toEqual({
      email: 'EMAIL_',
      webhook: 'WEBHOOK_',
      rateLimit: 'RATE_LIMIT_',
    });
    const ok: AdapterEnvVar<'email'> = {
      name: 'EMAIL_API_KEY',
      secret: true,
      required: true,
      description: 'x',
    };
    void ok;
    // @ts-expect-error a webhook var on an email adapter
    const wrong: AdapterEnvVar<'email'> = { ...ok, name: 'WEBHOOK_URL' };
    void wrong;
  });

  it('uses the @pwp/schema primitives for addresses, locales and slugs', () => {
    expectTypeOf<EmailAddress['address']>().toEqualTypeOf<Email>();
    expectTypeOf<EmailMessage['locale']>().toEqualTypeOf<LocaleCode>();
    expectTypeOf<WebhookEvent['tenant']>().toEqualTypeOf<Slug>();
  });

  it('AdapterError derives retryable from its code', () => {
    const e = new AdapterError('webhook', 'mock-webhook', 'timeout', 'webhook timed out');
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('AdapterError');
    expect(e.retryable).toBe(true);
    expect(new AdapterError('email', 'mock-email', 'rejected', 'x').retryable).toBe(false);
    expect(Object.isFrozen(RETRYABLE_ADAPTER_ERROR_CODES)).toBe(true);
  });

  it('webhook signing input is "<timestamp>.<rawBody>"', () => {
    expect(webhookSigningInput(1_763_640_000, '{"a":1}')).toBe('1763640000.{"a":1}');
    expect(() => webhookSigningInput(1.5, '')).toThrow(RangeError);
    expect(() => webhookSigningInput(-1, '')).toThrow(RangeError);
    expect(WEBHOOK_TOLERANCE_SECONDS).toBe(300);
  });
});
