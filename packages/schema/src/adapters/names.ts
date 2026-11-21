import { z } from 'zod';

/**
 * Adapter names (#64). An adapter's name equals its folder name under
 * `packages/adapters/src/<name>/`, and the set of names is closed.
 *
 * Adding a name is a `type:contract` change with security review: a real provider adapter also
 * adds CSP origins and env vars, so these tuples are a security-relevant allow-list (#52).
 * A new name must also get an entry in {@link ADAPTER_PRODUCTION_SUPPORT}; the compiler enforces
 * that.
 */
export const EMAIL_ADAPTER_NAMES = ['mock-email'] as const;
export const WEBHOOK_ADAPTER_NAMES = ['mock-webhook'] as const;
export const RATE_LIMIT_ADAPTER_NAMES = ['memory-rate-limit'] as const;

export const EmailAdapterName = z.enum(EMAIL_ADAPTER_NAMES);
export type EmailAdapterName = z.infer<typeof EmailAdapterName>;

export const WebhookAdapterName = z.enum(WEBHOOK_ADAPTER_NAMES);
export type WebhookAdapterName = z.infer<typeof WebhookAdapterName>;

export const RateLimitAdapterName = z.enum(RATE_LIMIT_ADAPTER_NAMES);
export type RateLimitAdapterName = z.infer<typeof RateLimitAdapterName>;

/** The adapter kinds a tenant selects by name. These are also the keys of `AdapterSelection`. */
export const ADAPTER_KINDS = ['email', 'webhook', 'rateLimit'] as const;
export type AdapterKind = (typeof ADAPTER_KINDS)[number];

/** Closed set of adapter names per kind. */
export const ADAPTER_NAMES = {
  email: EMAIL_ADAPTER_NAMES,
  webhook: WEBHOOK_ADAPTER_NAMES,
  rateLimit: RATE_LIMIT_ADAPTER_NAMES,
} as const satisfies Record<AdapterKind, readonly string[]>;

/** Name type per kind. */
export interface AdapterNameByKind {
  readonly email: EmailAdapterName;
  readonly webhook: WebhookAdapterName;
  readonly rateLimit: RateLimitAdapterName;
}

/** Any adapter name. */
export type AdapterName = AdapterNameByKind[AdapterKind];

/**
 * Where an adapter may run:
 * - `never`: development and tests only. It must not be selected for a production build or
 *   deploy (all `mock-*` adapters: they deliver nothing and lose submissions silently).
 * - `long-lived-server`: production only on a long-lived server process, never on serverless or
 *   edge hosts (in-memory state resets on every cold start and is not shared between instances).
 * - `any`: fit for every production target.
 */
export const ADAPTER_PRODUCTION_SUPPORTS = ['never', 'long-lived-server', 'any'] as const;
export type AdapterProductionSupport = (typeof ADAPTER_PRODUCTION_SUPPORTS)[number];

/**
 * Production fitness of every adapter name. This is data only: the production-build check that
 * refuses unfit adapters is #101, which reads this table. Every name must appear here (the
 * `satisfies` clause fails to compile otherwise), and every `mock-*` name must be `never` (tested).
 */
export const ADAPTER_PRODUCTION_SUPPORT = Object.freeze({
  'mock-email': 'never',
  'mock-webhook': 'never',
  'memory-rate-limit': 'long-lived-server',
} as const satisfies Record<AdapterName, AdapterProductionSupport>);
