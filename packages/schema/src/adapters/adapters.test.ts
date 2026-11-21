import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';
import * as adapters from './index.js';
import {
  ADAPTER_KINDS,
  ADAPTER_NAMES,
  ADAPTER_PRODUCTION_SUPPORT,
  ADAPTER_PRODUCTION_SUPPORTS,
  AdapterSelection,
  EmailAdapterName,
  RateLimitAdapterName,
  WebhookAdapterName,
  type AdapterName,
  type AdapterNameByKind,
} from './index.js';
import {
  adapterSelectionFixtures,
  emailAdapterNameFixtures,
  rateLimitAdapterNameFixtures,
  webhookAdapterNameFixtures,
} from './fixtures.js';
import type { Fixtures } from '../primitives/fixtures.js';

const label = (value: unknown): string => String(JSON.stringify(value));

function table(name: string, schema: z.ZodType, fixtures: Fixtures): void {
  describe(name, () => {
    it.each(fixtures.valid.map((v) => [label(v), v]))('accepts %s', (_, value) => {
      expect(schema.safeParse(value).success).toBe(true);
    });
    it.each(fixtures.invalid.map((v) => [label(v), v]))('rejects %s', (_, value) => {
      expect(schema.safeParse(value).success).toBe(false);
    });
  });
}

table('EmailAdapterName', EmailAdapterName, emailAdapterNameFixtures);
table('WebhookAdapterName', WebhookAdapterName, webhookAdapterNameFixtures);
table('RateLimitAdapterName', RateLimitAdapterName, rateLimitAdapterNameFixtures);
table('AdapterSelection', AdapterSelection, adapterSelectionFixtures);

const allNames = Object.values(ADAPTER_NAMES).flat();

describe('adapter names', () => {
  it('match the names in use today (#48, #49 folders)', () => {
    expect(ADAPTER_NAMES).toEqual({
      email: ['mock-email'],
      webhook: ['mock-webhook'],
      rateLimit: ['memory-rate-limit'],
    });
    expect(Object.keys(ADAPTER_NAMES)).toEqual([...ADAPTER_KINDS]);
    expectTypeOf<AdapterName>().toEqualTypeOf<
      'mock-email' | 'mock-webhook' | 'memory-rate-limit'
    >();
  });

  it('every name is accepted by its kind fixtures and enum', () => {
    expect(emailAdapterNameFixtures.valid).toEqual([...EmailAdapterName.options]);
    expect(webhookAdapterNameFixtures.valid).toEqual([...WebhookAdapterName.options]);
    expect(rateLimitAdapterNameFixtures.valid).toEqual([...RateLimitAdapterName.options]);
  });

  it('are unique across kinds and are valid folder names', () => {
    expect(new Set(allNames).size).toBe(allNames.length);
    for (const name of allNames) expect(name).toMatch(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
  });

  it('enum types equal the name types per kind', () => {
    expectTypeOf<z.infer<typeof EmailAdapterName>>().toEqualTypeOf<AdapterNameByKind['email']>();
    expectTypeOf<z.infer<typeof WebhookAdapterName>>().toEqualTypeOf<
      AdapterNameByKind['webhook']
    >();
    expectTypeOf<z.infer<typeof RateLimitAdapterName>>().toEqualTypeOf<
      AdapterNameByKind['rateLimit']
    >();
  });
});

describe('AdapterSelection', () => {
  it('has exactly one key per adapter kind', () => {
    expect(Object.keys(AdapterSelection.shape).sort()).toEqual([...ADAPTER_KINDS].sort());
  });

  it('infers the selection type', () => {
    expectTypeOf<AdapterSelection>().toEqualTypeOf<{
      email?: 'mock-email' | undefined;
      webhook?: 'mock-webhook' | undefined;
      rateLimit: 'memory-rate-limit';
    }>();
  });

  it('reports an unknown key as unrecognized_keys', () => {
    const result = AdapterSelection.safeParse({ rateLimit: 'memory-rate-limit', sms: 'x' });
    expect(result.success).toBe(false);
    expect(result.error?.issues).toMatchObject([
      { code: 'unrecognized_keys', keys: ['sms'], path: [] },
    ]);
  });

  it('reports an unknown name at its key', () => {
    const result = AdapterSelection.safeParse({ email: 'resend', rateLimit: 'memory-rate-limit' });
    expect(result.error?.issues).toMatchObject([{ code: 'invalid_value', path: ['email'] }]);
  });
});

describe('ADAPTER_PRODUCTION_SUPPORT (data for #101)', () => {
  it('classifies every name and nothing else', () => {
    expect(Object.keys(ADAPTER_PRODUCTION_SUPPORT).sort()).toEqual([...allNames].sort());
    for (const support of Object.values(ADAPTER_PRODUCTION_SUPPORT)) {
      expect(ADAPTER_PRODUCTION_SUPPORTS).toContain(support);
    }
  });

  it('never allows a mock-* adapter in production', () => {
    const mocks = allNames.filter((name) => name.startsWith('mock-'));
    expect(mocks.length).toBeGreaterThan(0);
    for (const name of mocks) expect(ADAPTER_PRODUCTION_SUPPORT[name]).toBe('never');
  });

  it('limits memory-* adapters to long-lived servers or never', () => {
    for (const name of allNames.filter((n) => n.startsWith('memory-'))) {
      expect(['never', 'long-lived-server']).toContain(ADAPTER_PRODUCTION_SUPPORT[name]);
    }
  });

  it('is frozen', () => {
    expect(Object.isFrozen(ADAPTER_PRODUCTION_SUPPORT)).toBe(true);
  });
});

describe('subpath exports', () => {
  it('exports exactly the contract', () => {
    expect(Object.keys(adapters).sort()).toEqual(
      [
        'ADAPTER_KINDS',
        'ADAPTER_NAMES',
        'ADAPTER_PRODUCTION_SUPPORT',
        'ADAPTER_PRODUCTION_SUPPORTS',
        'AdapterSelection',
        'EMAIL_ADAPTER_NAMES',
        'EmailAdapterName',
        'RATE_LIMIT_ADAPTER_NAMES',
        'RateLimitAdapterName',
        'WEBHOOK_ADAPTER_NAMES',
        'WebhookAdapterName',
      ].sort(),
    );
  });
});
