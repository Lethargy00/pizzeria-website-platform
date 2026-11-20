import { z } from 'zod';

/*
 * The value grammar of every theme token (#34). Each token value ends up inside generated CSS
 * (`--color-bg: #fffaf0;`), so every string here is matched by an anchored regular expression
 * over a small character set, and everything else is an enum or a number. No rule accepts
 * `(` except the fixed `oklch(` prefix, and none accepts `;`, `{`, `}`, `@`, `\`, quotes, `/*`,
 * `<`, `>` or whitespace other than single spaces between `oklch()` channels. That is what makes
 * `url(…)`, `@import`, `expression(…)` and breaking out of a declaration impossible, whatever
 * the CSS generator (#35) does with the value.
 */

/**
 * A hex color, `#rgb` or `#rrggbb`, either case. No alpha: the contrast gate (#36) needs opaque
 * colors.
 */
export const HexColor = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
export type HexColor = z.infer<typeof HexColor>;

/** Lightness: `0` to `1` (up to 4 decimals) or `0%` to `100%` (up to 2 decimals). */
const OKLCH_L_NUMBER = String.raw`0(?:\.\d{1,4})?|1(?:\.0{1,4})?`;
const OKLCH_L_PERCENT = String.raw`(?:\d{1,2}(?:\.\d{1,2})?|100(?:\.0{1,2})?)%`;
const OKLCH_L = `(?:${OKLCH_L_NUMBER}|${OKLCH_L_PERCENT})`;
/** Chroma: `0` to `0.9999`. Real sRGB and P3 colors stay below 0.4. */
const OKLCH_C = String.raw`0(?:\.\d{1,4})?`;
/** Hue in degrees, `0` to `360`, up to 2 decimals, no unit. */
const OKLCH_H = String.raw`(?:(?:\d{1,2}|[12]\d{2}|3[0-5]\d)(?:\.\d{1,2})?|360(?:\.0{1,2})?)`;

/**
 * An `oklch(L C H)` color in lowercase with single spaces, e.g. `oklch(62.8% 0.258 29.23)` or
 * `oklch(0.628 0.258 29.23)`. No alpha, no `none`, no `deg` unit and no relative color syntax.
 */
export const OklchColor = z
  .string()
  .regex(new RegExp(String.raw`^oklch\(${OKLCH_L} ${OKLCH_C} ${OKLCH_H}\)$`));
export type OklchColor = z.infer<typeof OklchColor>;

/** A color token: a {@link HexColor} or an {@link OklchColor}. Named colors are not accepted. */
export const Color = z.union([HexColor, OklchColor]);
export type Color = z.infer<typeof Color>;

/** The units a length token may use. */
export const LENGTH_UNITS = ['px', 'rem', 'em'] as const;

const MAGNITUDE = String.raw`(?:0|[1-9]\d{0,2})(?:\.\d{1,4})?`;
const UNIT = `(?:${LENGTH_UNITS.join('|')})`;

/**
 * A length: `0`, or a number from 0 to 999.9999 (up to 4 decimals) followed by `px`, `rem` or
 * `em`, e.g. `1rem`, `0.75rem`, `1.0625rem`, `4px`. No negatives, no `%`, no `calc()`, no leading
 * `.`.
 */
export const Length = z.string().regex(new RegExp(`^(?:0|${MAGNITUDE}${UNIT})$`));
export type Length = z.infer<typeof Length>;

/** A {@link Length} that may be negative, e.g. `-1px`. Used for shadow offsets only. */
export const SignedLength = z.string().regex(new RegExp(`^(?:0|-?${MAGNITUDE}${UNIT})$`));
export type SignedLength = z.infer<typeof SignedLength>;

/** A font weight: 100 to 900 in steps of 100. */
export const FontWeight = z.number().int().min(100).max(900).multipleOf(100);
export type FontWeight = z.infer<typeof FontWeight>;

/** A unitless line height, from 1 to 3. */
export const LineHeight = z.number().min(1).max(3);
export type LineHeight = z.infer<typeof LineHeight>;

/** An opacity, from 0 to 1. */
export const Opacity = z.number().min(0).max(1);
export type Opacity = z.infer<typeof Opacity>;

/** Maximum length of a font family name. */
export const MAX_FONT_NAME_LENGTH = 64;

/**
 * The name of a self-hosted font family, e.g. `Playfair Display` or `Inter`. ASCII letters and
 * digits in words separated by a single space or hyphen. The generator always quotes it, and the
 * grammar leaves nothing that could close the quote.
 */
export const FontName = z
  .string()
  .max(MAX_FONT_NAME_LENGTH)
  .regex(/^[A-Za-z0-9]+(?:[ -][A-Za-z0-9]+)*$/);
export type FontName = z.infer<typeof FontName>;

/** The generic families a font stack may end in. No other font is ever named. */
export const GENERIC_FONT_FAMILIES = ['serif', 'sans-serif', 'monospace', 'system-ui'] as const;
export const GenericFontFamily = z.enum(GENERIC_FONT_FAMILIES);
export type GenericFontFamily = z.infer<typeof GenericFontFamily>;

export const FONT_STYLES = ['normal', 'italic'] as const;
export const FontStyle = z.enum(FONT_STYLES);
export type FontStyle = z.infer<typeof FontStyle>;
