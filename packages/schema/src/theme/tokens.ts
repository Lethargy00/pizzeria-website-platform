import { z } from 'zod';
import { FontRef, ImageRef, strictObject } from '../primitives/index.js';
import {
  Color,
  FontName,
  FontStyle,
  FontWeight,
  GenericFontFamily,
  Length,
  LineHeight,
  Opacity,
  SignedLength,
} from './values.js';

/**
 * The semantic color roles. Components use only these, never a literal color. Intended pairings
 * for the contrast gate (#36) are listed in `README.md`.
 */
export const COLOR_ROLES = [
  'bg',
  'surface',
  'text',
  'muted',
  'primary',
  'onPrimary',
  'accent',
  'onAccent',
  'border',
  'focus',
  'danger',
  'success',
] as const;
export type ColorRole = (typeof COLOR_ROLES)[number];

/** One color scheme: a {@link Color} for every role in {@link COLOR_ROLES}. */
export const ColorRoles = strictObject({
  bg: Color,
  surface: Color,
  text: Color,
  muted: Color,
  primary: Color,
  onPrimary: Color,
  accent: Color,
  onAccent: Color,
  border: Color,
  focus: Color,
  danger: Color,
  success: Color,
} satisfies Record<ColorRole, typeof Color>);
export type ColorRoles = z.infer<typeof ColorRoles>;

/**
 * The light and the dark scheme. Both are always defined, even when {@link DarkMode} is
 * `never`.
 */
export const ThemeColors = strictObject({ light: ColorRoles, dark: ColorRoles });
export type ThemeColors = z.infer<typeof ThemeColors>;

/** Maximum number of font files per family. */
export const MAX_FONT_FACES = 8;

/** One WOFF2 file of a family, e.g. the bold italic cut. */
export const FontFace = strictObject({
  src: FontRef,
  weight: FontWeight,
  style: FontStyle,
});
export type FontFace = z.infer<typeof FontFace>;

/**
 * A self-hosted font family: its name, its WOFF2 files and the generic family the stack falls
 * back to. Fonts are only ever referenced this way; no system or third-party font is named.
 * `src` is resolved against the folder of the file that declares it (the theme package, or the
 * tenant folder for a `theme.yaml` override), and the build fails if the file is missing.
 */
export const FontFamily = strictObject({
  name: FontName,
  faces: z.array(FontFace).min(1).max(MAX_FONT_FACES),
  fallback: GenericFontFamily,
});
export type FontFamily = z.infer<typeof FontFamily>;

/** The type scale, smallest to largest. `base` is body text. */
export const TYPE_SCALE_STEPS = ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl'] as const;

export const TypeScale = strictObject({
  xs: Length,
  sm: Length,
  base: Length,
  lg: Length,
  xl: Length,
  '2xl': Length,
  '3xl': Length,
  '4xl': Length,
} satisfies Record<(typeof TYPE_SCALE_STEPS)[number], typeof Length>);
export type TypeScale = z.infer<typeof TypeScale>;

export const FontWeights = strictObject({
  body: FontWeight,
  heading: FontWeight,
  strong: FontWeight,
});
export type FontWeights = z.infer<typeof FontWeights>;

export const LineHeights = strictObject({ body: LineHeight, heading: LineHeight });
export type LineHeights = z.infer<typeof LineHeights>;

export const Typography = strictObject({
  body: FontFamily,
  heading: FontFamily,
  scale: TypeScale,
  weights: FontWeights,
  lineHeights: LineHeights,
});
export type Typography = z.infer<typeof Typography>;

/** The spacing scale, smallest to largest. */
export const SPACING_STEPS = ['xs', 'sm', 'md', 'lg', 'xl', '2xl'] as const;

export const Spacing = strictObject({
  xs: Length,
  sm: Length,
  md: Length,
  lg: Length,
  xl: Length,
  '2xl': Length,
} satisfies Record<(typeof SPACING_STEPS)[number], typeof Length>);
export type Spacing = z.infer<typeof Spacing>;

export const Radius = strictObject({ sm: Length, md: Length, lg: Length });
export type Radius = z.infer<typeof Radius>;

/** One box shadow, as structured values (never a free CSS string). */
export const Shadow = strictObject({
  x: SignedLength,
  y: SignedLength,
  blur: Length,
  spread: SignedLength,
  color: Color,
  opacity: Opacity,
});
export type Shadow = z.infer<typeof Shadow>;

/** A shadow level: a {@link Shadow}, or `none`. */
export const ShadowToken = z.union([z.literal('none'), Shadow]);
export type ShadowToken = z.infer<typeof ShadowToken>;

export const Shadows = strictObject({ sm: ShadowToken, md: ShadowToken, lg: ShadowToken });
export type Shadows = z.infer<typeof Shadows>;

export const BUTTON_STYLES = ['square', 'rounded', 'pill'] as const;
/** The corner style of buttons. */
export const ButtonStyle = z.enum(BUTTON_STYLES);
export type ButtonStyle = z.infer<typeof ButtonStyle>;

export const IMAGE_TREATMENTS = ['rounded', 'framed', 'full-bleed'] as const;
/** How content images are presented. */
export const ImageTreatment = z.enum(IMAGE_TREATMENTS);
export type ImageTreatment = z.infer<typeof ImageTreatment>;

export const DARK_MODES = ['never', 'system'] as const;
/**
 * `never`: the site is always light (not `off`, which YAML 1.1 parsers read as `false`).
 * `system`: the site follows the visitor's `prefers-color-scheme`. A visitor-facing toggle can be
 * added later as another value.
 */
export const DarkMode = z.enum(DARK_MODES);
export type DarkMode = z.infer<typeof DarkMode>;

/**
 * A complete token set: what a starter theme in `packages/themes` defines, and what a tenant
 * build uses after {@link applyThemeOverride}. Strict at every level.
 */
export const ThemeTokens = strictObject({
  colors: ThemeColors,
  typography: Typography,
  spacing: Spacing,
  radius: Radius,
  shadows: Shadows,
  buttonStyle: ButtonStyle,
  imageTreatment: ImageTreatment,
  darkMode: DarkMode,
  /** The tenant's logo. Starter themes usually leave it out; tenants set it in `theme.yaml`. */
  logo: ImageRef.optional(),
});
export type ThemeTokens = z.infer<typeof ThemeTokens>;
