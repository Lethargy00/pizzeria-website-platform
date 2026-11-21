/**
 * Valid and invalid fixtures for `@pwp/schema/adapters` (#64). Used by `adapters.test.ts`; not
 * exported from the subpath. A mock `AdapterSelection` for other packages' tests is
 * `adapterSelectionFixtures.valid[0]` (the dev/test default).
 */
import type { Fixtures } from '../primitives/fixtures.js';

const NOT_STRINGS = [undefined, null, 1, true, [], {}] as const;

/** Shared look-alike cases; each list below adds the near misses of its own names. */
const NOT_A_NAME = [
  ...NOT_STRINGS,
  '',
  ' ',
  'mock',
  'redis',
  'resend',
  'sendgrid',
  '__proto__',
  'constructor',
  '../mock-email',
  'mock-email/../x',
] as const;

export const emailAdapterNameFixtures: Fixtures = {
  valid: ['mock-email'],
  invalid: [
    ...NOT_A_NAME,
    'Mock-Email',
    'MOCK-EMAIL',
    'mock_email',
    'mockEmail',
    'mock-email ',
    ' mock-email',
    'mock-email\n',
    'mock-webhook',
    'memory-rate-limit',
  ],
};

export const webhookAdapterNameFixtures: Fixtures = {
  valid: ['mock-webhook'],
  invalid: [
    ...NOT_A_NAME,
    'Mock-Webhook',
    'MOCK-WEBHOOK',
    'mock_webhook',
    'mock-webhook ',
    'mock-email',
    'memory-rate-limit',
  ],
};

export const rateLimitAdapterNameFixtures: Fixtures = {
  valid: ['memory-rate-limit'],
  invalid: [
    ...NOT_A_NAME,
    'Memory-Rate-Limit',
    'MEMORY-RATE-LIMIT',
    'memory_rate_limit',
    'memory-rate-limit ',
    'memory',
    'mock-email',
    'mock-webhook',
  ],
};

export const adapterSelectionFixtures: Fixtures = {
  valid: [
    { rateLimit: 'memory-rate-limit' },
    { email: 'mock-email', rateLimit: 'memory-rate-limit' },
    { webhook: 'mock-webhook', rateLimit: 'memory-rate-limit' },
    { email: 'mock-email', webhook: 'mock-webhook', rateLimit: 'memory-rate-limit' },
  ],
  invalid: [
    ...NOT_STRINGS.filter((v) => !(typeof v === 'object' && v !== null && !Array.isArray(v))),
    'memory-rate-limit',
    {},
    { email: 'mock-email' },
    { email: 'mock-email', webhook: 'mock-webhook' },
    { rateLimit: 'redis' },
    { rateLimit: 'Memory-Rate-Limit' },
    { rateLimit: null },
    { email: 'mock-webhook', rateLimit: 'memory-rate-limit' },
    { webhook: 'mock-email', rateLimit: 'memory-rate-limit' },
    { email: 'resend', rateLimit: 'memory-rate-limit' },
    { email: null, rateLimit: 'memory-rate-limit' },
    { email: '', rateLimit: 'memory-rate-limit' },
    // Unknown keys
    { rateLimit: 'memory-rate-limit', analytics: 'mock-analytics' },
    { rateLimit: 'memory-rate-limit', rate_limit: 'memory-rate-limit' },
    { rateLimit: 'memory-rate-limit', Email: 'mock-email' },
    { ratelimit: 'memory-rate-limit' },
    JSON.parse('{"rateLimit":"memory-rate-limit","__proto__":{"email":"mock-email"}}'),
  ],
};
