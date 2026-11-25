import { z } from 'zod';
import type { PrimitiveIssueParams } from './issue-params.js';
import { singleLineText, textRuleSource } from './text.js';

/** Every locale the platform supports (DECISIONS #3). */
export const LOCALES = ['sv', 'en'] as const;
/** The default locale: used when a tenant does not choose one, and first in every list. */
export const DEFAULT_LOCALE = 'sv' satisfies (typeof LOCALES)[number];

export const LocaleCode = z.enum(LOCALES);
export type LocaleCode = z.infer<typeof LocaleCode>;

/** Maximum length of one translation of a {@link LocalizedString}. Long-form text is Markdown. */
export const MAX_LOCALIZED_TEXT_LENGTH = 2000;

/** The character rule of {@link LocalizedText}: the `singleLineText` rule with LF allowed. */
const MULTI_LINE = new RegExp(textRuleSource('multi'), 'u');

/**
 * One translation: trimmed, 1 to {@link MAX_LOCALIZED_TEXT_LENGTH} characters, and may span
 * several lines. It follows the same character rules as `singleLineText` (#188), except that
 * LF is allowed:
 *
 * - LF (U+000A) is the only line break. CR, CR LF, NEL, U+2028 / U+2029, TAB and every other
 *   C0 or C1 control are rejected. YAML already turns line breaks in a block scalar into LF;
 * - no bidi controls, zero-width or other format characters, lone surrogates, private-use or
 *   unassigned code points, noncharacters or blank look-alikes;
 * - no more than four nonspacing or enclosing marks in a row (a line break ends a run), no
 *   invisible marks, and variation selectors only where they change what a reader sees (a
 *   selector right after a line break is rejected);
 * - at least one visible character in the whole value.
 *
 * ZWJ emoji, tag-sequence flags and text that needs joiners are rejected, as in
 * `singleLineText`; see the reasons there. One mistake gives one issue: `invalid_type`,
 * `too_small`, `too_big`, or a single `invalid_format` (format `regex`) for any character rule.
 */
export const LocalizedText = z
  .string()
  .trim()
  .min(1)
  .max(MAX_LOCALIZED_TEXT_LENGTH)
  .regex(MULTI_LINE);

/** A text in one or more locales, e.g. `{ sv: 'Meny', en: 'Menu' }`. */
export type LocalizedString = Partial<Record<LocaleCode, string>>;

/**
 * A localized text in the context of a tenant: exactly one entry for each locale the tenant
 * enabled in its site config, and no others. Each entry is a {@link LocalizedText}, which may span
 * several lines; for text that must stay on one line use {@link localizedLineFor}.
 *
 * - A missing enabled locale raises a `custom` issue with `pwpCode: 'missing_locale'` and the
 *   `locale`, at the path of the missing key (`[...path, 'en']`).
 * - A locale the tenant did not enable, or any other key, is an unknown key (`strictObject`).
 *
 * Schemas that contain localized text are therefore built for a tenant's locales: the domain
 * schema is a function of a `LocaleContext` (for example `menuSchema({ locales })`), and the site
 * loader passes the locales from the validated `site.config.yaml`. This is the convention for
 * every later schema; there is no global locale state.
 */
export function localizedStringFor(locales: readonly LocaleCode[]) {
  return localizedFor(locales, LocalizedText);
}

/**
 * A localized text that must stay on one line, e.g. an image's `alt` text or a dish name (#188):
 * {@link localizedStringFor} with `singleLineText(max)` for each locale, so each translation is
 * trimmed, 1 to `max` characters, and follows every `singleLineText` rule (no line breaks at
 * all). Missing and unknown locales are reported exactly as in {@link localizedStringFor}, and
 * the output type is the same `{ sv?: string; en?: string }`.
 */
export function localizedLineFor(locales: readonly LocaleCode[], max: number) {
  return localizedFor(locales, singleLineText(max));
}

/** The shared body of {@link localizedStringFor} and {@link localizedLineFor}. */
function localizedFor<T extends z.ZodType<string, string>>(
  locales: readonly LocaleCode[],
  text: T,
) {
  const enabled = new Set(locales);
  const shape: Partial<Record<LocaleCode, z.ZodOptional<T>>> = {};
  for (const locale of LOCALES) {
    if (enabled.has(locale)) shape[locale] = text.optional();
  }
  // Typed as if every locale were present so the output type is `{ sv?: string; en?: string }`;
  // at runtime the keys of locales that are not enabled are unknown keys.
  const fullShape = shape as Record<LocaleCode, z.ZodOptional<T>>;
  return z.strictObject(fullShape).superRefine((value, ctx) => {
    for (const locale of LOCALES) {
      if (enabled.has(locale) && value[locale] === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [locale],
          message: `Missing the \`${locale}\` text.`,
          params: { pwpCode: 'missing_locale', locale } satisfies PrimitiveIssueParams,
        });
      }
    }
  });
}

/** The context a schema with localized text is built for. */
export interface LocaleContext {
  /** The tenant's enabled locales, from its validated site config. */
  readonly locales: readonly LocaleCode[];
}

/**
 * A localized text before the tenant's locales are known: at least one supported locale, no
 * unknown keys. Use this only where no {@link LocaleContext} exists (for example, platform
 * defaults); tenant content uses {@link localizedStringFor}.
 */
export const LocalizedString = z
  .strictObject({ sv: LocalizedText.optional(), en: LocalizedText.optional() })
  .refine((value) => LOCALES.some((locale) => value[locale] !== undefined), {
    error: 'Give the text in at least one locale.',
    params: { pwpCode: 'missing_locale', locale: DEFAULT_LOCALE } satisfies PrimitiveIssueParams,
  });
