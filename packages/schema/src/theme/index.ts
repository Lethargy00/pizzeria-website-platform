/**
 * `@pwp/schema/theme`: the theme token contract (#34).
 *
 * - {@link ThemeTokens}: a complete token set, defined by each starter theme in `packages/themes`.
 * - {@link ThemeOverride}: a tenant's `theme.yaml`, a partial token set.
 * - {@link applyThemeOverride}: merges the two into the tenant's token set.
 *
 * Every token value is a regex-checked string, an enum or a number (see `values.ts`), so no value
 * can carry CSS syntax such as `url(`, `;`, `}`, `@import` or `expression(`. CSS generation and the
 * contrast gate are not part of this contract (#35, #36). Guide: `README.md` in this folder.
 */
export {
  HexColor,
  OklchColor,
  Color,
  LENGTH_UNITS,
  Length,
  SignedLength,
  FontWeight,
  LineHeight,
  Opacity,
  MAX_FONT_NAME_LENGTH,
  FontName,
  GENERIC_FONT_FAMILIES,
  GenericFontFamily,
  FONT_STYLES,
  FontStyle,
} from './values.js';
export {
  COLOR_ROLES,
  ColorRoles,
  ThemeColors,
  MAX_FONT_FACES,
  FontFace,
  FontFamily,
  TYPE_SCALE_STEPS,
  TypeScale,
  FontWeights,
  LineHeights,
  Typography,
  SPACING_STEPS,
  Spacing,
  Radius,
  Shadow,
  ShadowToken,
  Shadows,
  BUTTON_STYLES,
  ButtonStyle,
  IMAGE_TREATMENTS,
  ImageTreatment,
  DARK_MODES,
  DarkMode,
  ThemeTokens,
  type ColorRole,
} from './tokens.js';
export { ThemeOverride, applyThemeOverride } from './override.js';
