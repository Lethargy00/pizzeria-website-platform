/**
 * Adapter contracts (ADR 0001, issues #48, #82). Owner: architect.
 *
 * This folder holds **types and constants only**. Implementations live in
 * `packages/adapters/src/<adapter-name>/` (mocks first, #49) and import from here.
 *
 * Conventions every adapter follows:
 * - **Name = folder.** An adapter's `name` equals its folder name under `packages/adapters/src/`.
 *   The set of names is closed. It is defined once, in `@pwp/schema/adapters` (#64), and
 *   re-exported here unchanged. Adding a provider adapter is a contract change there, because it
 *   also changes CSP origins, env vars and `ADAPTER_PRODUCTION_SUPPORT`.
 * - **Production fitness** of each name lives only in `@pwp/schema/adapters`
 *   (`ADAPTER_PRODUCTION_SUPPORT`). Factories don't repeat it.
 * - **Discovery.** Each adapter folder's `index.ts` exports `factory`, an {@link AdapterFactory}.
 *   No central registry lists adapters.
 * - **Env vars.** Declared by the factory as {@link AdapterEnvVar} descriptors, unprefixed,
 *   `UPPER_SNAKE_CASE`, starting with the kind prefix (`EMAIL_`, `WEBHOOK_`, `RATE_LIMIT_`; the
 *   compiler enforces the prefix and upper case through {@link AdapterEnvVarName}).
 *   The build maps `PWP_<SLUG>_<NAME>` to `<NAME>` per tenant (ADR 0001, build isolation).
 * - **PII.** Every field that may carry personal data is tagged `@pii` in its doc comment.
 *   Adapters never log `@pii` fields, never put them in error messages, and never send them
 *   anywhere except the delivery target of that call.
 */

import type { AdapterKind, AdapterNameByKind } from '@pwp/schema/adapters';

export * from './email.js';
export * from './rate-limit.js';
export * from './webhook.js';

/**
 * Re-exported from `@pwp/schema/adapters` (#64, #82): the adapter kinds, the closed name set per
 * kind, and the per-tenant selection. `AdapterSelection` is the schema's inferred type as is
 * (optional keys accept `undefined`, properties are not `readonly`); wrap it in `Readonly<>`
 * where immutability matters.
 */
export {
  ADAPTER_NAMES,
  type AdapterKind,
  type AdapterNameByKind,
  type AdapterName,
  type AdapterSelection,
} from '@pwp/schema/adapters';

/** Prefix that every env var of an adapter kind must start with. */
export const ADAPTER_ENV_PREFIX = {
  email: 'EMAIL_',
  webhook: 'WEBHOOK_',
  rateLimit: 'RATE_LIMIT_',
} as const satisfies Record<AdapterKind, string>;

/**
 * An env var name of kind `K`: the kind's {@link ADAPTER_ENV_PREFIX} followed by an upper-case
 * rest, e.g. `EMAIL_FROM`. The compiler rejects `FROM`, `WEBHOOK_URL` for an email adapter and
 * `EMAIL_from`. The full `UPPER_SNAKE_CASE` shape (`[A-Z0-9_]` only) is checked in review and
 * by `pwp validate`, because a template-literal type can't express it.
 */
export type AdapterEnvVarName<K extends AdapterKind = AdapterKind> = K extends AdapterKind
  ? `${(typeof ADAPTER_ENV_PREFIX)[K]}${Uppercase<string>}`
  : never;

/** One environment variable an adapter of kind `K` reads. */
export interface AdapterEnvVar<K extends AdapterKind = AdapterKind> {
  /** Unprefixed `UPPER_SNAKE_CASE` name that starts with the kind's {@link ADAPTER_ENV_PREFIX}. */
  readonly name: AdapterEnvVarName<K>;
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
  readonly env: readonly AdapterEnvVar<K>[];
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
export const RETRYABLE_ADAPTER_ERROR_CODES: readonly AdapterErrorCode[] = Object.freeze([
  'throttled',
  'timeout',
  'unavailable',
] as const);

/**
 * The only error type adapters throw. Any other thrown value is a bug in the adapter.
 *
 * `K` ties `adapter` to `kind`: `new AdapterError('email', 'mock-webhook', …)` does not compile.
 * `AdapterError` without a type argument is an error of any kind, which is what `catch` and
 * `instanceof` give callers.
 *
 * `message` and `cause` follow the same rule, because loggers usually serialise `cause` too:
 * neither may contain PII, secrets, env var values, target URLs (e.g. `WEBHOOK_URL`, which is
 * secret) or provider response bodies. HTTP client errors often embed the request URL, so
 * don't pass them through as `cause`. Instead, use a new PII-free `Error` that describes the
 * failure class, or omit `cause`.
 */
export class AdapterError<K extends AdapterKind = AdapterKind> extends Error {
  override readonly name = 'AdapterError';
  readonly kind: K;
  readonly adapter: AdapterNameByKind[K];
  readonly code: AdapterErrorCode;
  readonly retryable: boolean;

  constructor(
    kind: K,
    adapter: NoInfer<AdapterNameByKind[K]>,
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
