/**
 * Adapter contracts (ADR 0001, issue #48). Owner: architect.
 *
 * This folder holds **types and constants only**. Implementations live in
 * `packages/adapters/src/<adapter-name>/` (mocks first, #49) and import from here.
 *
 * Conventions every adapter follows:
 * - **Name = folder.** An adapter's `name` equals its folder name under `packages/adapters/src/`.
 *   The set of names is closed (the `*_ADAPTER_NAMES` tuples below). Adding a provider adapter is a
 *   contract change, because it also changes CSP origins and env vars.
 * - **Discovery.** Each adapter folder's `index.ts` exports `factory`, an {@link AdapterFactory}.
 *   No central registry lists adapters.
 * - **Env vars.** Declared by the factory as {@link AdapterEnvVar} descriptors, unprefixed,
 *   `UPPER_SNAKE_CASE`, starting with the kind prefix (`EMAIL_`, `WEBHOOK_`, `RATE_LIMIT_`).
 *   The build maps `PWP_<SLUG>_<NAME>` to `<NAME>` per tenant (ADR 0001, build isolation).
 * - **PII.** Every field that may carry personal data is tagged `@pii` in its doc comment.
 *   Adapters never log `@pii` fields, never put them in error messages, and never send them
 *   anywhere except the delivery target of that call.
 *
 * Follow-ups:
 * - #64 moves the adapter-name enums and {@link AdapterSelection} to `@pwp/schema/adapters`
 *   (Zod) so that `SiteConfig` (#52) can reference them; this file then re-exports them.
 * - #22 (`@pwp/schema/primitives`) is not merged yet, so plain string types are used where
 *   `Email`, `Slug` and `IsoDate` primitives will later apply.
 */

import { EMAIL_ADAPTER_NAMES } from './email.js';
import type { EmailAdapterName } from './email.js';
import { RATE_LIMIT_ADAPTER_NAMES } from './rate-limit.js';
import type { RateLimitAdapterName } from './rate-limit.js';
import { WEBHOOK_ADAPTER_NAMES } from './webhook.js';
import type { WebhookAdapterName } from './webhook.js';

export * from './email.js';
export * from './rate-limit.js';
export * from './webhook.js';

/** The adapter kinds covered by this contract. */
export type AdapterKind = 'email' | 'webhook' | 'rateLimit';

/** Closed set of adapter names per kind. Moves to `@pwp/schema/adapters` in #64. */
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
 * Which adapter a tenant uses per kind, chosen **by name** in site config (#52).
 * `email` and `webhook` are optional (notifications off when absent);
 * every tenant with forms needs a `rateLimit` store.
 */
export interface AdapterSelection {
  readonly email?: EmailAdapterName;
  readonly webhook?: WebhookAdapterName;
  readonly rateLimit: RateLimitAdapterName;
}

/** Prefix that every env var of an adapter kind must start with. */
export const ADAPTER_ENV_PREFIX = {
  email: 'EMAIL_',
  webhook: 'WEBHOOK_',
  rateLimit: 'RATE_LIMIT_',
} as const satisfies Record<AdapterKind, string>;

/** One environment variable an adapter reads. */
export interface AdapterEnvVar {
  /** Unprefixed `UPPER_SNAKE_CASE` name that starts with the kind's {@link ADAPTER_ENV_PREFIX}. */
  readonly name: string;
  /** Secrets are never logged, echoed in errors, or written to build output. */
  readonly secret: boolean;
  /** Missing required vars fail the build (`pwp build`) and the function cold start. */
  readonly required: boolean;
  /** One line for docs and `pwp validate` output. */
  readonly description: string;
}

/**
 * The tenant's environment as an adapter sees it: only that tenant's vars, already unprefixed.
 * Values are strings exactly as provided; adapters validate them in `create`.
 */
export type AdapterEnv = Readonly<Record<string, string | undefined>>;

/** What each adapter folder exports as `factory`. */
export interface AdapterFactory<K extends AdapterKind, TAdapter> {
  readonly kind: K;
  readonly name: AdapterNameByKind[K];
  /** Every env var the adapter reads. Reading an undeclared var is a review blocker. */
  readonly env: readonly AdapterEnvVar[];
  /**
   * Builds the adapter. Throws {@link AdapterError} with code `misconfigured` when a required
   * var is missing or invalid; the message names the var, never its value.
   */
  create(env: AdapterEnv): TAdapter;
}

/** Closed set of error codes shared by all adapters. */
export type AdapterErrorCode =
  /** The caller passed data the adapter or provider refuses (validation, size). Not retryable. */
  | 'invalid_input'
  /** Missing or invalid configuration or credentials. Not retryable. */
  | 'misconfigured'
  /** The provider rejected the request for policy reasons (e.g. recipient blocked). Not retryable. */
  | 'rejected'
  /** The provider throttled us. Retryable after a delay. */
  | 'throttled'
  /** The provider or store did not answer in time. Retryable. */
  | 'timeout'
  /** The provider or store is down or answered with a server error. Retryable. */
  | 'unavailable';

/** Codes after which the same call may be retried (with backoff and the same idempotency key). */
export const RETRYABLE_ADAPTER_ERROR_CODES: readonly AdapterErrorCode[] = [
  'throttled',
  'timeout',
  'unavailable',
];

/**
 * The only error type adapters throw. Any other thrown value is a bug in the adapter.
 *
 * `message` must not contain PII, secrets, env var values or provider response bodies: it may
 * be logged. Put the provider's raw error in `cause` only if it is free of PII.
 */
export class AdapterError extends Error {
  override readonly name = 'AdapterError';
  readonly kind: AdapterKind;
  readonly adapter: AdapterName;
  readonly code: AdapterErrorCode;
  readonly retryable: boolean;

  constructor(
    kind: AdapterKind,
    adapter: AdapterName,
    code: AdapterErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.kind = kind;
    this.adapter = adapter;
    this.code = code;
    this.retryable = RETRYABLE_ADAPTER_ERROR_CODES.includes(code);
  }
}

/** Per-call options shared by all adapter methods. */
export interface AdapterCallOptions {
  /** Upper bound for the whole call including retries inside the adapter. Default: adapter's own. */
  readonly timeoutMs?: number;
}
