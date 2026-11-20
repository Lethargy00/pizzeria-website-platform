import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import type { Fixtures } from '../primitives/fixtures.js';
import { FontRef, ImageRef } from '../primitives/index.js';
import {
  COLOR_ROLES,
  Color,
  FontName,
  FontWeight,
  HexColor,
  Length,
  LineHeight,
  OklchColor,
  SignedLength,
  ThemeOverride,
  ThemeTokens,
  applyThemeOverride,
} from './index.js';
import {
  CSS_INJECTION_PAYLOADS,
  exampleTheme,
  fontNameFixtures,
  fontWeightFixtures,
  hexColorFixtures,
  invalidOverrides,
  lengthFixtures,
  lineHeightFixtures,
  oklchColorFixtures,
  signedLengthFixtures,
  validOverrides,
} from './fixtures.js';

const label = (value: unknown): string =>
  typeof value === 'string' ? JSON.stringify(value) : String(JSON.stringify(value));

function table(name: string, schema: z.ZodType, fixtures: Fixtures): void {
  describe(name, () => {
    it.each(fixtures.valid.map((v) => [label(v), v]))('accepts %s', (_, value) => {
      expect(schema.safeParse(value).success).toBe(true);
    });
    it.each(fixtures.invalid.map((v) => [label(v), v]))('rejects %s', (_, value) => {
      expect(schema.safeParse(value).success).toBe(false);
    });
  });
}

table('HexColor', HexColor, hexColorFixtures);
table('OklchColor', OklchColor, oklchColorFixtures);
table('Color', Color, {
  valid: [...hexColorFixtures.valid, ...oklchColorFixtures.valid],
  invalid: [...new Set([...hexColorFixtures.invalid, ...oklchColorFixtures.invalid])],
});
table('Length', Length, lengthFixtures);
table('SignedLength', SignedLength, signedLengthFixtures);
table('FontName', FontName, fontNameFixtures);
table('FontWeight', FontWeight, fontWeightFixtures);
table('LineHeight', LineHeight, lineHeightFixtures);
table('ThemeOverride', ThemeOverride, { valid: validOverrides, invalid: invalidOverrides });

type Path = (string | number)[];

/** Every path in `value` that holds a string, e.g. `['colors', 'light', 'bg']`. */
function stringLeaves(value: unknown, path: Path = []): Path[] {
  if (typeof value === 'string') return [path];
  if (Array.isArray(value)) return value.flatMap((v, i) => stringLeaves(v, [...path, i]));
  if (typeof value === 'object' && value !== null)
    return Object.entries(value).flatMap(([k, v]) => stringLeaves(v, [...path, k]));
  return [];
}

/** Every path in `value` that holds a plain object (including the root). */
function objectPaths(value: unknown, path: Path = []): Path[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => objectPaths(v, [...path, i]));
  if (typeof value === 'object' && value !== null)
    return [path, ...Object.entries(value).flatMap(([k, v]) => objectPaths(v, [...path, k]))];
  return [];
}

/** A deep copy of a JSON-safe value. */
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** A deep copy of `value` with `update` applied to the node at `path`. */
function withAt(value: unknown, path: Path, update: (node: unknown) => unknown): unknown {
  const copy = clone(value);
  if (path.length === 0) return update(copy);
  let node = copy as Record<string | number, unknown>;
  for (const key of path.slice(0, -1)) node = node[key] as Record<string | number, unknown>;
  const last = path[path.length - 1] as string | number;
  node[last] = update(node[last]);
  return copy;
}

const STRING_LEAVES = stringLeaves(exampleTheme);

describe('CSS injection', () => {
  const stringSchemas: [string, z.ZodType][] = [
    ['HexColor', HexColor],
    ['OklchColor', OklchColor],
    ['Color', Color],
    ['Length', Length],
    ['SignedLength', SignedLength],
    ['FontName', FontName],
    ['FontRef', FontRef],
    ['ImageRef', ImageRef],
  ];

  it.each(stringSchemas)('%s rejects every payload', (_, schema) => {
    for (const payload of CSS_INJECTION_PAYLOADS) {
      expect(schema.safeParse(payload).success, payload).toBe(false);
    }
  });

  it('covers every string token of the example theme', () => {
    expect(STRING_LEAVES.length).toBeGreaterThan(40);
  });

  it.each(STRING_LEAVES.map((p): [string, Path] => [p.join('.'), p]))(
    'ThemeTokens rejects every payload at %s',
    (_, path) => {
      for (const payload of CSS_INJECTION_PAYLOADS) {
        const result = ThemeTokens.safeParse(withAt(exampleTheme, path, () => payload));
        expect(result.success, `${payload} at ${path.join('.')}`).toBe(false);
      }
    },
  );

  it('ThemeOverride rejects every payload at every string token', () => {
    for (const path of STRING_LEAVES) {
      for (const payload of CSS_INJECTION_PAYLOADS) {
        const override = withAt(exampleTheme, path, () => payload);
        expect(ThemeOverride.safeParse(override).success, `${payload} at ${path.join('.')}`).toBe(
          false,
        );
      }
    }
  });

  it('ThemeTokens rejects a payload as the logo', () => {
    for (const payload of CSS_INJECTION_PAYLOADS) {
      expect(ThemeTokens.safeParse({ ...exampleTheme, logo: payload }).success).toBe(false);
    }
  });
});

describe('ThemeTokens', () => {
  it('accepts the example theme unchanged', () => {
    expect(ThemeTokens.parse(exampleTheme)).toEqual(exampleTheme);
  });

  it('accepts a logo', () => {
    expect(ThemeTokens.parse({ ...exampleTheme, logo: 'assets/logo.webp' }).logo).toBe(
      'assets/logo.webp',
    );
  });

  it('defines every color role for light and dark', () => {
    expect(Object.keys(exampleTheme.colors.light).sort()).toEqual([...COLOR_ROLES].sort());
    for (const role of COLOR_ROLES) {
      for (const scheme of ['light', 'dark']) {
        const without = withAt(exampleTheme, ['colors', scheme], (node) =>
          Object.fromEntries(Object.entries(node as object).filter(([key]) => key !== role)),
        );
        expect(ThemeTokens.safeParse(without).success, `${scheme}.${role}`).toBe(false);
      }
    }
  });

  it('is an override too: a full token set is a valid ThemeOverride', () => {
    expect(ThemeOverride.safeParse(exampleTheme).success).toBe(true);
  });

  it.each(objectPaths(exampleTheme).map((p): [string, Path] => [p.join('.') || '(root)', p]))(
    'rejects an unknown key at %s (ThemeTokens and ThemeOverride)',
    (_, path) => {
      const value = withAt(exampleTheme, path, (node) => ({
        ...(node as object),
        css: 'x',
      }));
      const result = ThemeTokens.safeParse(value);
      expect(result.success).toBe(false);
      // A shadow level is a union with `none`, so its unknown key is nested in the union issue.
      if (path[0] !== 'shadows') {
        expect(result.error?.issues).toContainEqual(
          expect.objectContaining({ code: 'unrecognized_keys', keys: ['css'], path }),
        );
      }
      expect(ThemeOverride.safeParse(value).success).toBe(false);
    },
  );

  it('does not let __proto__ through', () => {
    const polluted: unknown = JSON.parse(
      JSON.stringify(exampleTheme).replace('{"bg"', '{"__proto__":{"x":1},"bg"'),
    );
    expect(ThemeTokens.safeParse(polluted).success).toBe(false);
    expect(ThemeOverride.safeParse(polluted).success).toBe(false);
    expect(ThemeOverride.safeParse(JSON.parse('{"__proto__":{"darkMode":"off"}}')).success).toBe(
      false,
    );
  });

  it('caps the number of font files per family', () => {
    const faces = Array.from({ length: 9 }, (_, i) => ({
      src: `assets/fonts/f${i}.woff2`,
      weight: 400,
      style: 'normal',
    }));
    const value = withAt(exampleTheme, ['typography', 'body', 'faces'], () => faces);
    expect(ThemeTokens.safeParse(value).success).toBe(false);
  });
});

describe('applyThemeOverride', () => {
  const base = ThemeTokens.parse(exampleTheme);

  it('returns the base unchanged for an empty override', () => {
    expect(applyThemeOverride(base, ThemeOverride.parse({}))).toEqual(base);
  });

  it('merges colors one role at a time', () => {
    const result = applyThemeOverride(
      base,
      ThemeOverride.parse({ colors: { light: { primary: '#0b5d1e' } } }),
    );
    expect(result.colors.light).toEqual({ ...base.colors.light, primary: '#0b5d1e' });
    expect(result.colors.dark).toEqual(base.colors.dark);
  });

  it('merges scale steps, weights, spacing, radius and shadows key by key', () => {
    const result = applyThemeOverride(
      base,
      ThemeOverride.parse({
        typography: { scale: { base: '1.0625rem' }, weights: { heading: 800 } },
        spacing: { md: '1.25rem' },
        radius: { lg: '16px' },
        shadows: { md: 'none' },
      }),
    );
    expect(result.typography.scale).toEqual({ ...base.typography.scale, base: '1.0625rem' });
    expect(result.typography.weights).toEqual({ ...base.typography.weights, heading: 800 });
    expect(result.typography.lineHeights).toEqual(base.typography.lineHeights);
    expect(result.spacing).toEqual({ ...base.spacing, md: '1.25rem' });
    expect(result.radius).toEqual({ ...base.radius, lg: '16px' });
    expect(result.shadows).toEqual({ ...base.shadows, md: 'none' });
  });

  it('replaces a font family as a whole', () => {
    const heading = {
      name: 'Tenant Display',
      faces: [{ src: 'assets/fonts/tenant-display.woff2', weight: 800, style: 'normal' }],
      fallback: 'serif',
    };
    const result = applyThemeOverride(base, ThemeOverride.parse({ typography: { heading } }));
    expect(result.typography.heading).toEqual(heading);
    expect(result.typography.body).toEqual(base.typography.body);
  });

  it('sets the enums and the logo', () => {
    const result = applyThemeOverride(
      base,
      ThemeOverride.parse({
        buttonStyle: 'pill',
        imageTreatment: 'full-bleed',
        darkMode: 'never',
        logo: 'assets/logo.png',
      }),
    );
    expect(result).toMatchObject({
      buttonStyle: 'pill',
      imageTreatment: 'full-bleed',
      darkMode: 'never',
      logo: 'assets/logo.png',
    });
    expect('logo' in applyThemeOverride(base, {})).toBe(false);
  });

  it('does not change its arguments, and its result is a valid ThemeTokens', () => {
    const before = clone(base);
    for (const raw of validOverrides) {
      const override = ThemeOverride.parse(raw);
      const snapshot = clone(override);
      const result = applyThemeOverride(base, override);
      expect(ThemeTokens.parse(result)).toEqual(result);
      expect(override).toEqual(snapshot);
    }
    expect(base).toEqual(before);
  });
});
