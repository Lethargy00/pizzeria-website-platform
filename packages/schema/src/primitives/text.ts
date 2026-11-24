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
 * The 66 Unicode noncharacters: U+FDD0 to U+FDEF and the last two code points of every plane
 * (U+FFFE, U+FFFF, U+1FFFE, U+1FFFF, …, U+10FFFE, U+10FFFF). They are permanently reserved for
 * internal use and break XML parsers and some HTML pipelines (#194). They are also `\p{Cn}`, but
 * are listed by value so the rule does not depend on that.
 */
const NONCHARACTERS =
  String.raw`\u{FDD0}-\u{FDEF}` +
  Array.from({ length: 17 }, (_, plane) => {
    const hex = (plane * 0x10000 + 0xfffe).toString(16).toUpperCase();
    return String.raw`\u{${hex}}\u{${hex.slice(0, -1)}F}`;
  }).join('');

/**
 * Letters and symbols that render as nothing, so a value made of them looks blank and one ending
 * in them looks like a different word (`Roma` + U+3164 next to `Roma`, #194): the Hangul fillers
 * U+115F, U+1160, U+3164 and U+FFA0, the Braille blank U+2800 and the object replacement
 * character U+FFFC. They are rejected anywhere in the value, not just ignored as "not visible".
 */
const BLANK_LOOKALIKES = String.raw`\u{115F}\u{1160}\u{3164}\u{FFA0}\u{2800}\u{FFFC}`;

/**
 * Characters that never belong in one line of text: C0 and C1 controls (NUL, TAB, CR, LF, ESC,
 * NEL, …), format characters (zero-width space, joiners, bidi embeddings, overrides and isolates,
 * LRM/RLM, word joiner, soft hyphen, BOM), lone surrogates, the Unicode line and paragraph
 * separators U+2028 / U+2029, private-use characters (`\p{Co}`), unassigned code points
 * (`\p{Cn}`), the noncharacters and the blank look-alikes above.
 */
const NOT_IN_A_LINE = String.raw`\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}\p{Co}\p{Cn}${NONCHARACTERS}${BLANK_LOOKALIKES}`;

/** A character a reader can see: a letter, a digit, punctuation or a symbol (emoji included). */
const VISIBLE = String.raw`\p{L}\p{N}\p{P}\p{S}`;

/**
 * The longest run of combining marks (`\p{M}`: accents, variation selectors, enclosing keycap)
 * allowed in a row. Real text needs one to three (Vietnamese stacks two, a keycap emoji has a
 * variation selector and U+20E3); longer runs are "Zalgo" text that draws over neighbouring
 * lines (#194).
 */
const MAX_COMBINING_MARK_RUN = 4;

/**
 * Empty (left to `.min(1)`), or only allowed characters with at least one visible one, and no run
 * of more than `MAX_COMBINING_MARK_RUN` combining marks. Empty is accepted here on purpose so
 * that a blank value gets one `too_small` issue and not a second `invalid_format` one.
 *
 * The blank look-alikes are letters and symbols, so the visible character is "visible and not in
 * `NOT_IN_A_LINE`". Both parts stay linear on long input: the first look-ahead tries a fixed-length
 * run of marks at each position once, and the part before the first visible character excludes
 * visible characters, so there is only one way to match the rest. One regex (not two) keeps it to one issue per value.
 */
const SINGLE_LINE = new RegExp(
  `^(?![\\s\\S]*\\p{M}{${MAX_COMBINING_MARK_RUN + 1}})` +
    `(?:[^${NOT_IN_A_LINE}${VISIBLE}]*(?![${NOT_IN_A_LINE}])[${VISIBLE}][^${NOT_IN_A_LINE}]*)?$`,
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
 *   This also rejects emoji joined with U+200D (family emoji) and tag-sequence flags (England,
 *   Scotland, Wales); single emoji, skin tones, keycaps and country flags are fine;
 * - no private-use characters, no unassigned code points and none of the 66 noncharacters
 *   (#194). "Unassigned" follows the Unicode version of the running JavaScript engine, so a
 *   character added in a newer Unicode version than the server's is rejected until it upgrades;
 * - no blank look-alikes: Hangul fillers (U+115F, U+1160, U+3164, U+FFA0), Braille blank U+2800
 *   and U+FFFC, anywhere in the value (#194);
 * - no more than `MAX_COMBINING_MARK_RUN` (4) combining marks or variation selectors in a row;
 * - at least one visible character (a letter, digit, punctuation mark or symbol).
 *
 * One mistake gives one issue: a non-string is `invalid_type`, a blank value `too_small`, a long
 * one `too_big`, and any character rule above a single `invalid_format` (format `regex`, no
 * `pwpCode`: this is a built-in Zod issue, not a `custom` one, #23).
 */
export function singleLineText(max: number) {
  return z.string().trim().min(1).max(max).regex(SINGLE_LINE);
}
