/**
 * `@pwp/schema/primitives`: the shared building blocks of every tenant-facing schema (#22).
 *
 * Rules for every schema built on these:
 * - Objects use {@link strictObject} at every level, never `z.object()`.
 * - Links use {@link SafeUrl}, file references use {@link AssetRef} / {@link ImageRef} /
 *   {@link FontRef}, never a plain string or `z.url()`.
 * - Text shown to visitors uses {@link localizedStringFor} with the tenant's {@link LocaleContext}.
 *   Plain one-line text that is not translated (a title in a per-locale file, a place name) uses
 *   {@link singleLineText}, never a hand-written `/^[^\r\n]*$/` rule.
 * - Strings and arrays carry `.max()` limits.
 * - Checks never write user-facing text themselves: they raise a `custom` issue with a `pwpCode`
 *   in `params` that the error mapping (`@pwp/schema/errors`, #23) turns into a message and hint.
 */
export { strictObject } from './strict-object.js';
export { MAX_SLUG_LENGTH, Slug, TimeOfDay, IsoDate, singleLineText } from './text.js';
export { MAX_EMAIL_LENGTH, Email, PhoneNumber } from './contact.js';
export {
  SAFE_URL_SCHEMES,
  MAX_URL_LENGTH,
  isSafeUrl,
  SafeUrl,
  type SafeUrlScheme,
} from './safe-url.js';
export {
  IMAGE_EXTENSIONS,
  FONT_EXTENSIONS,
  ASSET_EXTENSIONS,
  ASSET_DIR,
  MAX_ASSET_REF_LENGTH,
  isSafeAssetPath,
  AssetRef,
  ImageRef,
  FontRef,
} from './asset-ref.js';
export {
  LOCALES,
  DEFAULT_LOCALE,
  LocaleCode,
  MAX_LOCALIZED_TEXT_LENGTH,
  LocalizedText,
  LocalizedString,
  localizedStringFor,
  type LocaleContext,
} from './locale.js';
export { MAX_PRICE_SEK, PriceSEK } from './price.js';
export { WEEKDAYS, Weekday } from './weekday.js';
export { MAX_ISO_DATE_TIME_LENGTH, IsoDateTime } from './datetime.js';
export type { SafeHtml } from './safe-html.js';
