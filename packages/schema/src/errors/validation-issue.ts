/**
 * The shared validation error shape (contract #23). Schemas, the YAML loader (#53) and the CLI
 * all report problems as `ValidationIssue`s, so every tool shows the same file, path, message and
 * hint. Message guidelines: `packages/schema/README.md`.
 */

/**
 * Every code a `ValidationIssue` can carry. The list is closed: a new code is added through a
 * `type:contract` issue, so formatters and tests can rely on it.
 */
export const VALIDATION_ISSUE_CODES = [
  /** A key the schema does not know (`strictObject`). */
  'unknown_key',
  /** A required key is absent. */
  'missing_field',
  /** The value has the wrong type (text instead of a number, an empty value, …). */
  'wrong_type',
  /** The value is not one of the allowed values (enum, variant name, literal). */
  'invalid_value',
  /** A `LocalizedString` lacks a locale the tenant enabled (#22). */
  'missing_locale',
  /** A link fails the `SafeUrl` scheme allow-list (#22). */
  'unsafe_url',
  /** A file reference fails the `AssetRef` rules (#22). */
  'unsafe_path',
  /** Text too short, list too small, number too low, date too early. */
  'too_small',
  /** Text too long, list too big, number too high, date too late. */
  'too_big',
  /** The text does not have the required format (email, date, phone number, pattern). */
  'invalid_format',
  /** The number is not a multiple of a step (for example more than two decimals). */
  'not_multiple_of',
  /** The value matches none of the forms a union allows. */
  'no_matching_option',
  /** A key of a record or map is invalid. */
  'invalid_key',
  /** An entry of a map or set is invalid. */
  'invalid_entry',
  /** Anything else: a custom check without a known code, or an unknown Zod issue. */
  'invalid',
] as const;

export type ValidationIssueCode = (typeof VALIDATION_ISSUE_CODES)[number];

/** One problem in one tenant file. */
export interface ValidationIssue {
  /** Path of the file, relative to the repository root, e.g. `tenants/demo/site.config.yaml`. */
  file: string;
  /** 1-based line, filled in by the loader that knows the source positions (#53). */
  line?: number;
  /** 1-based column, filled in together with `line`. */
  column?: number;
  /** Key path to the value inside the file, e.g. `['pages', 'home', 'sections', 0, 'variant']`. */
  path: (string | number)[];
  code: ValidationIssueCode;
  /** What is wrong and what was expected. One English sentence, ends with a period. */
  message: string;
  /** How to fix it, as concretely as possible. */
  hint?: string;
}

/** The codes a schema's own checks (`.refine`, `.check`, `superRefine`) may raise. */
export const CUSTOM_ISSUE_CODES = ['missing_locale', 'unsafe_url', 'unsafe_path'] as const;

export type CustomIssueCode = (typeof CUSTOM_ISSUE_CODES)[number];

/**
 * The `params` of a Zod `custom` issue raised by a `@pwp/schema` check. `toValidationIssues`
 * reads `pwpCode` to pick the message and hint, so a primitive never writes user-facing text
 * itself:
 *
 * ```ts
 * z.string().refine(isSafeUrl, { params: { pwpCode: 'unsafe_url' } satisfies CustomIssueParams });
 * ```
 */
export interface CustomIssueParams {
  readonly pwpCode: CustomIssueCode;
  /** `missing_locale`: the locale that is missing, e.g. `en`. */
  readonly locale?: string;
  /** `unsafe_url`: the allowed schemes, if they differ from `https:`, `mailto:`, `tel:`. */
  readonly allowedSchemes?: readonly string[];
  /** `unsafe_path`: the allowed file extensions, e.g. `['.jpg', '.png']`. */
  readonly allowedExtensions?: readonly string[];
}

/**
 * The parts of a Zod 4 issue (`z.core.$ZodIssue`) the mapping reads. Typed loosely on purpose:
 * every field is checked at runtime, so the mapping keeps working if Zod adds issue kinds or
 * fields, and the errors module needs no runtime import of `zod`.
 */
export interface ZodIssueLike {
  readonly code?: string;
  readonly path?: readonly PropertyKey[];
  readonly message?: string;
  readonly input?: unknown;
  readonly expected?: unknown;
  readonly values?: unknown;
  readonly keys?: unknown;
  readonly origin?: unknown;
  readonly minimum?: unknown;
  readonly maximum?: unknown;
  readonly inclusive?: unknown;
  readonly exact?: unknown;
  readonly format?: unknown;
  readonly pattern?: unknown;
  readonly prefix?: unknown;
  readonly suffix?: unknown;
  readonly includes?: unknown;
  readonly divisor?: unknown;
  readonly errors?: unknown;
  readonly issues?: unknown;
  readonly discriminator?: unknown;
  readonly params?: unknown;
}
