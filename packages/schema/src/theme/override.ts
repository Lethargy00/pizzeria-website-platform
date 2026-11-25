import type { z } from 'zod';
import { ImageRef, strictObject } from '../primitives/index.js';
import {
  ButtonStyle,
  ColorRoles,
  DarkMode,
  FontFamily,
  FontWeights,
  ImageTreatment,
  LineHeights,
  Radius,
  Shadows,
  Spacing,
  TypeScale,
  type ThemeTokens,
} from './tokens.js';

/**
 * A tenant's `theme.yaml`: a partial {@link ThemeTokens}. Every key at every level is optional and
 * unknown keys are still rejected at every level. Groups of related values are merged key by key
 * (one color, one scale step); a font family is replaced as a whole, because its files must match
 * its name. See {@link applyThemeOverride}.
 */
export const ThemeOverride = strictObject({
  colors: strictObject({
    light: ColorRoles.partial(),
    dark: ColorRoles.partial(),
  }).partial(),
  typography: strictObject({
    body: FontFamily,
    heading: FontFamily,
    scale: TypeScale.partial(),
    weights: FontWeights.partial(),
    lineHeights: LineHeights.partial(),
  }).partial(),
  spacing: Spacing.partial(),
  radius: Radius.partial(),
  shadows: Shadows.partial(),
  buttonStyle: ButtonStyle,
  imageTreatment: ImageTreatment,
  darkMode: DarkMode,
  logo: ImageRef,
}).partial();
export type ThemeOverride = z.infer<typeof ThemeOverride>;

/** `base` with every key of `changes` that is set. Only keys of `base` are read. */
function patch<T extends object>(
  base: T,
  changes: { readonly [K in keyof T]?: T[K] | undefined } | undefined,
): T {
  if (changes === undefined) return base;
  const out: T = { ...base };
  for (const key of Object.keys(base) as (keyof T)[]) {
    const value = changes[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/**
 * Applies a parsed tenant override to a parsed base theme and returns the tenant's full token
 * set. Pure: neither argument is changed. Both arguments must come from `ThemeTokens.parse` and
 * `ThemeOverride.parse`; the result needs no second validation, since every value in it passed
 * one of the two schemas.
 */
export function applyThemeOverride(base: ThemeTokens, override: ThemeOverride): ThemeTokens {
  const typography = override.typography;
  const merged: ThemeTokens = {
    colors: {
      light: patch(base.colors.light, override.colors?.light),
      dark: patch(base.colors.dark, override.colors?.dark),
    },
    typography: {
      body: typography?.body ?? base.typography.body,
      heading: typography?.heading ?? base.typography.heading,
      scale: patch(base.typography.scale, typography?.scale),
      weights: patch(base.typography.weights, typography?.weights),
      lineHeights: patch(base.typography.lineHeights, typography?.lineHeights),
    },
    spacing: patch(base.spacing, override.spacing),
    radius: patch(base.radius, override.radius),
    shadows: patch(base.shadows, override.shadows),
    buttonStyle: override.buttonStyle ?? base.buttonStyle,
    imageTreatment: override.imageTreatment ?? base.imageTreatment,
    darkMode: override.darkMode ?? base.darkMode,
  };
  const logo = override.logo ?? base.logo;
  return logo === undefined ? merged : { ...merged, logo };
}
