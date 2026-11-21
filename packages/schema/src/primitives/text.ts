import { z } from 'zod';

/** Maximum length of a tenant slug (also used as the folder name under `tenants/`). */
export const MAX_SLUG_LENGTH = 64;

/**
 * A URL- and folder-safe identifier: lowercase ASCII letters and digits in groups separated by
 * single hyphens, e.g. `pizzeria-roma`, `home`, `lunch-2026`. No leading, trailing or double
 * hyphens, no dots, no slashes, so a slug can never form a path.
 */
export const Slug = z
  .string()
  .min(1)
  .max(MAX_SLUG_LENGTH)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export type Slug = z.infer<typeof Slug>;

/**
 * A time of day on a 24-hour clock, `HH:MM`, from `00:00` to `23:59`. `24:00` is not accepted;
 * the hours schema expresses "until midnight" and overnight hours itself.
 */
export const TimeOfDay = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export type TimeOfDay = z.infer<typeof TimeOfDay>;

/**
 * A calendar date, `YYYY-MM-DD`, that exists (leap years are checked). Kept as a string: it is a
 * date in `Europe/Stockholm`, not an instant, and `@pwp/core` interprets it.
 */
export const IsoDate = z.iso.date();
export type IsoDate = z.infer<typeof IsoDate>;

/**
 * Characters that never belong in one line of text: C0 and C1 controls (NUL, TAB, CR, LF, ESC,
 * NEL, …), format characters (zero-width space, joiners, bidi embeddings, overrides and isolates,
 * LRM/RLM, word joiner, soft hyphen, BOM), lone surrogates, and the Unicode line and paragraph
 * separators U+2028 / U+2029.
 */
const NOT_IN_A_LINE = String.raw`\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}`;

/** A character a reader can see: a letter, a digit, punctuation or a symbol (emoji included). */
const VISIBLE = String.raw`\p{L}\p{N}\p{P}\p{S}`;

/**
 * Empty (left to `.min(1)`), or only allowed characters with at least one visible one. Empty is
 * accepted here on purpose so that a blank value gets one `too_small` issue and not a second
 * `invalid_format` one. The part before the first visible character excludes visible characters,
 * so there is only one way to match and the check stays linear on long input.
 */
const SINGLE_LINE = new RegExp(
  `^(?:[^${NOT_IN_A_LINE}${VISIBLE}]*[${VISIBLE}][^${NOT_IN_A_LINE}]*)?$`,
  'u',
);

/**
 * One line of plain text a visitor sees, e.g. a page title, a location name or a street (#157).
 * Trimmed, 1 to `max` characters (UTF-16 units, after trimming), and safe to put in a `<title>`,
 * a meta tag, a log line or a one-line protocol field such as a mail subject:
 *
 * - no control characters (NUL, TAB, CR, LF, NEL, ESC, …) and no U+2028 / U+2029;
 * - no bidi controls (U+202A to U+202E, U+2066 to U+2069, LRM, RLM, ALM), so text cannot be
 *   visually reordered;
 * - no zero-width or other format characters (U+200B to U+200D, U+2060, U+FEFF, soft hyphen).
 *   This also rejects emoji joined with U+200D (family emoji); single emoji are fine;
 * - at least one visible character (a letter, digit, punctuation mark or symbol).
 *
 * One mistake gives one issue: a non-string is `invalid_type`, a blank value `too_small`, a long
 * one `too_big`, and any character rule above a single `invalid_format` (format `regex`).
 */
export function singleLineText(max: number) {
  return z.string().trim().min(1).max(max).regex(SINGLE_LINE);
}
