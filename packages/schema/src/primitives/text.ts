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
 * The C0 and C1 controls except LF: U+0000 to U+0009, U+000B to U+001F and U+007F to U+009F.
 * Together with LF this is exactly `\p{Cc}`, a set Unicode guarantees never to change, so listing
 * it by value changes nothing and lets the multi-line rule leave LF out (#188).
 */
const CONTROLS_EXCEPT_LF = String.raw`\u{0}-\u{9}\u{B}-\u{1F}\u{7F}-\u{9F}`;

/**
 * Characters that never belong in text, on one line or several (#188): C0 and C1 controls other
 * than LF (NUL, TAB, CR, ESC, NEL, …), format characters (zero-width space, joiners, bidi
 * embeddings, overrides and isolates, LRM/RLM, word joiner, soft hyphen, BOM, tag characters),
 * lone surrogates, the Unicode line and paragraph separators U+2028 / U+2029, private-use
 * characters (`\p{Co}`), unassigned code points (`\p{Cn}`), the noncharacters and the blank
 * look-alikes above.
 *
 * A character-class body (no brackets), used by {@link textRuleSource}.
 */
const NOT_IN_TEXT = String.raw`${CONTROLS_EXCEPT_LF}\p{Cf}\p{Cs}\p{Zl}\p{Zp}\p{Co}\p{Cn}${NONCHARACTERS}${BLANK_LOOKALIKES}`;

/**
 * Characters that never belong in one line of text: {@link NOT_IN_TEXT} and LF, so every C0 and
 * C1 control (`\p{Cc}`). A character-class body, used by {@link textRuleSource}.
 */
const NOT_IN_A_LINE = String.raw`\n${NOT_IN_TEXT}`;

/** A character a reader can see: a letter, a digit, punctuation or a symbol (emoji included). */
const VISIBLE = String.raw`\p{L}\p{N}\p{P}\p{S}`;

/**
 * Marks and symbols that render as nothing even after a visible character, so `Roma` followed by
 * one of them looks exactly like `Roma` but is a different value (#207). Rejected anywhere in the
 * value, listed by value so the rule does not depend on the engine's Unicode version:
 *
 * - U+034F combining grapheme joiner (CGJ);
 * - U+17B4 and U+17B5, the Khmer inherent vowels, which Unicode says not to use;
 * - U+1D159 musical symbol null notehead (a symbol, `\p{So}`, not a mark, but it draws nothing);
 * - U+16FE4 Khitan small script filler.
 */
const INVISIBLE_MARKS = String.raw`\u{034F}\u{17B4}\u{17B5}\u{1D159}\u{16FE4}`;

/**
 * Variation selectors in a place where they change nothing a reader can see (#207). An emoji
 * variation selector, U+FE0E (text style) or U+FE0F (emoji style), is allowed only right after an
 * emoji base (`\p{Emoji}`: a red heart, a hot beverage, the copyright sign). After a keycap
 * base (the digits, `#` and `*`, which are `\p{Emoji}` too) only U+FE0F is allowed, and only when
 * U+20E3 follows, as in the keycap `1` + U+FE0F + U+20E3. Anywhere else they are rejected, and
 * so are the other selectors (U+FE00 to U+FE0D and the ideographic selectors U+E0100 to U+E01EF)
 * everywhere. The Mongolian free variation selectors U+180B to U+180D and U+180F are
 * allowed only right after a Mongolian character, the only script they apply to.
 *
 * Each alternative looks at most one character back and one ahead, so it stays linear.
 */
const MISPLACED_SELECTOR =
  String.raw`[\u{FE00}-\u{FE0D}\u{E0100}-\u{E01EF}]` +
  String.raw`|(?<!\p{Emoji})[\u{FE0E}\u{FE0F}]` +
  String.raw`|(?<=[0-9#*])(?:\u{FE0E}|\u{FE0F}(?!\u{20E3}))` +
  String.raw`|(?<!\p{Script=Mongolian})[\u{180B}-\u{180D}\u{180F}]`;

/**
 * The longest run of nonspacing or enclosing marks (`\p{Mn}`, `\p{Me}`: accents, vowel signs drawn
 * above or below, viramas, enclosing keycap) allowed in a row. These stack on one base character,
 * so long runs are "Zalgo" text that draws over neighbouring lines (#194). Real text stays within
 * four: Vietnamese stacks two, Thai two, Tibetan stacks up to three or four subjoined letters and
 * vowels, and a keycap emoji has a variation selector and U+20E3.
 *
 * Spacing marks (`\p{Mc}`) do not count: they take up width like a letter, so they cannot pile
 * up over other lines. Burmese needs this: the word for "hope", U+1019 U+103B U+103E U+1031
 * U+102C U+103A, is one letter and five marks, three of them spacing (#207).
 */
const MAX_STACKED_MARK_RUN = 4;

/**
 * Patterns that make a value unsafe wherever they appear: a run of more than
 * `MAX_STACKED_MARK_RUN` stacking marks, an invisible mark, or a misplaced variation selector.
 * Every alternative has a bounded length, so `[\s\S]*` before it backtracks once per position and
 * the check stays linear. Shared by the one-line and the multi-line rule (#188).
 */
const UNSAFE_ANYWHERE =
  String.raw`[\p{Mn}\p{Me}]{${MAX_STACKED_MARK_RUN + 1}}` +
  `|[${INVISIBLE_MARKS}]` +
  `|${MISPLACED_SELECTOR}`;

/**
 * The source of a whole character rule in one regex, for the `u` flag, in two parts:
 *
 * 1. A look-ahead at the start that fails if any `UNSAFE_ANYWHERE` pattern occurs anywhere in
 *    the value (a long run of stacking marks, an invisible mark, a misplaced variation selector).
 * 2. The body: either the empty string, or characters none of which is in `notAllowed`, with at
 *    least one in `VISIBLE`. The blank look-alikes and U+1D159 are letters or symbols, so the
 *    required visible character is one in `VISIBLE` and not in `notAllowed`.
 *
 * Empty passes on purpose, so a blank value gets one `too_small` issue from `.min(1)` and not a
 * second `invalid_format` one. Both parts are in one regex so that a value breaking several
 * character rules still gets exactly one `invalid_format` issue.
 *
 * Both parts are linear in the length of the value. The look-ahead runs once, from the start,
 * and its `[\s\S]*` backtracks over each position once, trying only patterns of bounded length
 * there. In the body, the run before the first visible character cannot contain a visible
 * character, so there is exactly one way to split the value and no backtracking between parts.
 *
 * `lines: 'single'` uses {@link NOT_IN_A_LINE} (`singleLineText`); `lines: 'multi'` uses
 * {@link NOT_IN_TEXT}, which allows LF (`LocalizedText`, #188). `UNSAFE_ANYWHERE` works for both:
 * LF is not an emoji base or a Mongolian character, so a variation selector right after a line
 * break is still rejected, and LF is not a mark, so a line break ends a mark run.
 *
 * Returns the pattern string, not a compiled `RegExp`, so every caller compiles its own (with the
 * `u` flag) and no `lastIndex` state is ever shared. Internal to `@pwp/schema`: exported for the
 * other primitives (#188), not from `primitives/index.ts`.
 */
export function textRuleSource(lines: 'single' | 'multi'): string {
  const notAllowed = lines === 'single' ? NOT_IN_A_LINE : NOT_IN_TEXT;
  return (
    `^(?![\\s\\S]*(?:${UNSAFE_ANYWHERE}))` +
    `(?:[^${notAllowed}${VISIBLE}]*(?![${notAllowed}])[${VISIBLE}][^${notAllowed}]*)?$`
  );
}

/** The character rule of {@link singleLineText}. */
const SINGLE_LINE = new RegExp(textRuleSource('single'), 'u');

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
 * - no more than `MAX_STACKED_MARK_RUN` (4) nonspacing or enclosing marks in a row; spacing marks
 *   such as the Burmese and Devanagari vowel signs do not count (#207);
 * - no invisible marks (CGJ U+034F, Khmer U+17B4 and U+17B5, U+1D159, U+16FE4), anywhere (#207);
 * - variation selectors only where they change what a reader sees: U+FE0E or U+FE0F after an emoji
 *   base, U+FE0F in a keycap (`1` + U+FE0F + U+20E3), Mongolian selectors after a Mongolian
 *   character (#207). This also rejects ideographic variation sequences (a CJK character followed
 *   by U+E0100 to U+E01EF) and the standardized sequences with U+FE00 to U+FE0D;
 * - at least one visible character (a letter, digit, punctuation mark or symbol).
 *
 * One mistake gives one issue: a non-string is `invalid_type`, a blank value `too_small`, a long
 * one `too_big`, and any character rule above a single `invalid_format` (format `regex`, no
 * `pwpCode`: this is a built-in Zod issue, not a `custom` one, #23).
 *
 * Joiners are rejected on purpose (#188). U+200D (ZWJ) and U+200C (ZWNJ) are invisible, so
 * `Ro` + U+200D + `ma` looks exactly like `Roma` but is a different value, and allowing them
 * safely needs a rule that depends on context: ZWJ only between two emoji, joiners only between
 * two letters of a script that uses them. The cost is that ZWJ emoji (the cook, the family, the
 * rainbow flag) and the tag-sequence flags are rejected, and so is text in a script that needs
 * joiners (Persian, some Indic spellings). The platform supports `sv` and `en` (DECISIONS #3),
 * which need neither. Changing this takes a `type:contract` change to this rule and to
 * `LocalizedText`, which share it, never an override in one field.
 */
export function singleLineText(max: number) {
  return z.string().trim().min(1).max(max).regex(SINGLE_LINE);
}
