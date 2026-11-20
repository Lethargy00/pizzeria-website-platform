import { z } from 'zod';
import type { PrimitiveIssueParams } from './issue-params.js';

/** Every locale the platform supports (DECISIONS #3). */
export const LOCALES = ['sv', 'en'] as const;
/** The default locale: used when a tenant does not choose one, and first in every list. */
export const DEFAULT_LOCALE = 'sv' satisfies (typeof LOCALES)[number];

export const LocaleCode = z.enum(LOCALES);
export type LocaleCode = z.infer<typeof LocaleCode>;

/** Maximum length of one translation of a {@link LocalizedString}. Long-form text is Markdown. */
export const MAX_LOCALIZED_TEXT_LENGTH = 2000;

/** One translation: trimmed, not empty. */
export const LocalizedText = z.string().trim().min(1).max(MAX_LOCALIZED_TEXT_LENGTH);

/** A text in one or more locales, e.g. `{ sv: 'Meny', en: 'Menu' }`. */
export type LocalizedString = Partial<Record<LocaleCode, string>>;

/**
 * A localized text in the context of a tenant: exactly one entry for each locale the tenant
 * enabled in its site config, and no others.
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
  const enabled = new Set(locales);
  const shape: Partial<Record<LocaleCode, z.ZodOptional<typeof LocalizedText>>> = {};
  for (const locale of LOCALES) {
    if (enabled.has(locale)) shape[locale] = LocalizedText.optional();
  }
  // Typed as if every locale were present so the output type is `{ sv?: string; en?: string }`;
  // at runtime the keys of locales that are not enabled are unknown keys.
  const fullShape = shape as Record<LocaleCode, z.ZodOptional<typeof LocalizedText>>;
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
