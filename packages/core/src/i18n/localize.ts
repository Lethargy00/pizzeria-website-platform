import type { LocaleCode, LocalizedString } from '@pwp/schema/primitives';

/** The locale used when a text lacks the requested one (DECISIONS #3: Swedish is the default). */
export const FALLBACK_LOCALE = 'sv' satisfies LocaleCode;

/**
 * Reads a localized text (ADR 0003, decision 5). The only sanctioned way to read one: code never
 * indexes `text[locale]` directly.
 *
 * Returns `text[locale]`, otherwise `text[defaultLocale]`. Throws if both are missing, so a build
 * fails instead of rendering empty text. An empty string counts as missing.
 */
export function localize(
  text: LocalizedString,
  locale: LocaleCode,
  defaultLocale: LocaleCode,
): string {
  const wanted = text[locale];
  if (wanted) return wanted;
  const fallback = text[defaultLocale];
  if (fallback) return fallback;
  throw new Error(`Localized text has neither \`${locale}\` nor \`${defaultLocale}\`.`);
}

/** {@link localize} with `sv` as the default fallback locale. */
export function t(
  text: LocalizedString,
  locale: LocaleCode,
  fallback: LocaleCode = FALLBACK_LOCALE,
): string {
  return localize(text, locale, fallback);
}

const HREFLANG: Record<LocaleCode, string> = { sv: 'sv-SE', en: 'en' };

/** The `hreflang` / BCP 47 tag of a locale: `sv` is `sv-SE`, `en` is `en`. */
export function hreflang(locale: LocaleCode): string {
  return HREFLANG[locale];
}
