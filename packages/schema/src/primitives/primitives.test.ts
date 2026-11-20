import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import * as primitives from './index.js';
import {
  AssetRef,
  Email,
  FontRef,
  ImageRef,
  IsoDate,
  LocaleCode,
  LocalizedString,
  PhoneNumber,
  PriceSEK,
  SafeUrl,
  Slug,
  TimeOfDay,
  isSafeAssetPath,
  isSafeUrl,
  localizedStringFor,
  strictObject,
  type SafeHtml,
} from './index.js';
import {
  assetRefFixtures,
  emailFixtures,
  isoDateFixtures,
  localeCodeFixtures,
  localizedStringAnyFixtures,
  localizedStringSvEnFixtures,
  localizedStringSvFixtures,
  phoneNumberFixtures,
  priceSEKFixtures,
  safeUrlFixtures,
  slugFixtures,
  timeOfDayFixtures,
  type Fixtures,
} from './fixtures.js';
import * as root from '../index.js';
import pkg from '../../package.json' with { type: 'json' };

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

table('Slug', Slug, slugFixtures);
table('TimeOfDay', TimeOfDay, timeOfDayFixtures);
table('IsoDate', IsoDate, isoDateFixtures);
table('Email', Email, emailFixtures);
table('PhoneNumber', PhoneNumber, phoneNumberFixtures);
table('SafeUrl', SafeUrl, safeUrlFixtures);
table('AssetRef', AssetRef, assetRefFixtures);
table('LocaleCode', LocaleCode, localeCodeFixtures);
table(
  'localizedStringFor([sv, en])',
  localizedStringFor(['sv', 'en']),
  localizedStringSvEnFixtures,
);
table('localizedStringFor([sv])', localizedStringFor(['sv']), localizedStringSvFixtures);
table('LocalizedString (no context)', LocalizedString, localizedStringAnyFixtures);
table('PriceSEK', PriceSEK, {
  valid: priceSEKFixtures.valid.map(([kronor]) => kronor),
  invalid: priceSEKFixtures.invalid,
});

function customParams(result: { success: boolean; error?: z.ZodError }): unknown[] {
  return (result.error?.issues ?? []).map((issue) =>
    issue.code === 'custom' ? issue.params : undefined,
  );
}

describe('strictObject', () => {
  const Schema = strictObject({
    name: z.string(),
    contact: strictObject({ email: Email }),
  });

  it('accepts known keys', () => {
    expect(Schema.parse({ name: 'Roma', contact: { email: 'info@roma.se' } })).toEqual({
      name: 'Roma',
      contact: { email: 'info@roma.se' },
    });
  });

  it('rejects an unknown key and names the key and its path', () => {
    const result = Schema.safeParse({
      name: 'Roma',
      contact: { email: 'info@roma.se', emial: 'x' },
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual([
      expect.objectContaining({ code: 'unrecognized_keys', keys: ['emial'], path: ['contact'] }),
    ]);
    expect(result.error?.issues[0]?.message).toContain('emial');
  });

  it('rejects unknown keys at the top level', () => {
    const result = Schema.safeParse({
      name: 'Roma',
      contact: { email: 'info@roma.se' },
      script: 'x',
    });
    expect(result.error?.issues).toEqual([
      expect.objectContaining({ code: 'unrecognized_keys', keys: ['script'], path: [] }),
    ]);
  });

  it('does not let __proto__ or constructor through', () => {
    const polluted = JSON.parse(
      '{"name":"Roma","contact":{"email":"info@roma.se"},"__proto__":{"x":1}}',
    ) as unknown;
    expect(Schema.safeParse(polluted).success).toBe(false);
    expect(
      Schema.safeParse({ name: 'Roma', contact: { email: 'info@roma.se' }, constructor: 'x' })
        .success,
    ).toBe(false);
  });
});

describe('SafeUrl issues', () => {
  it('raises a custom issue with pwpCode unsafe_url', () => {
    expect(customParams(SafeUrl.safeParse('javascript:alert(1)'))).toEqual([
      { pwpCode: 'unsafe_url' },
    ]);
  });

  it('isSafeUrl agrees with SafeUrl on every string fixture', () => {
    for (const v of safeUrlFixtures.valid) expect(isSafeUrl(v as string)).toBe(true);
    for (const v of safeUrlFixtures.invalid) {
      if (typeof v === 'string') expect(isSafeUrl(v)).toBe(false);
    }
  });
});

describe('AssetRef issues and variants', () => {
  it('raises a custom issue with pwpCode unsafe_path and the allowed extensions', () => {
    expect(customParams(AssetRef.safeParse('assets/logo.svg'))).toEqual([
      {
        pwpCode: 'unsafe_path',
        allowedExtensions: ['.jpg', '.jpeg', '.png', '.webp', '.avif', '.woff2'],
      },
    ]);
  });

  it('ImageRef accepts images only, FontRef fonts only', () => {
    expect(ImageRef.safeParse('assets/hero.webp').success).toBe(true);
    expect(ImageRef.safeParse('assets/fonts/display.woff2').success).toBe(false);
    expect(FontRef.safeParse('assets/fonts/display.woff2').success).toBe(true);
    expect(FontRef.safeParse('assets/hero.webp').success).toBe(false);
  });

  it('isSafeAssetPath agrees with AssetRef on every string fixture', () => {
    for (const v of assetRefFixtures.valid) expect(isSafeAssetPath(v as string)).toBe(true);
    for (const v of assetRefFixtures.invalid) {
      if (typeof v === 'string') expect(isSafeAssetPath(v)).toBe(false);
    }
  });
});

describe('localizedStringFor', () => {
  const SvEn = localizedStringFor(['sv', 'en']);

  it('reports each missing enabled locale with pwpCode missing_locale at its own path', () => {
    const result = SvEn.safeParse({ sv: 'Meny' });
    expect(result.error?.issues).toEqual([
      expect.objectContaining({
        code: 'custom',
        path: ['en'],
        params: { pwpCode: 'missing_locale', locale: 'en' },
      }),
    ]);
  });

  it('reports a locale the tenant did not enable as an unknown key', () => {
    const result = localizedStringFor(['sv']).safeParse({ sv: 'Meny', en: 'Menu' });
    expect(result.error?.issues).toEqual([
      expect.objectContaining({ code: 'unrecognized_keys', keys: ['en'] }),
    ]);
  });

  it('reports the missing locale at the full path inside a larger schema', () => {
    const Menu = strictObject({ title: SvEn });
    const result = Menu.safeParse({ title: { sv: 'Meny' } });
    expect(result.error?.issues[0]?.path).toEqual(['title', 'en']);
  });

  it('trims each translation', () => {
    expect(SvEn.parse({ sv: '  Meny ', en: 'Menu' })).toEqual({ sv: 'Meny', en: 'Menu' });
  });
});

describe('PriceSEK', () => {
  it.each(priceSEKFixtures.valid.map(([kronor, ore]) => [kronor, ore]))(
    'turns %s kr into %s öre',
    (kronor, ore) => {
      const parsed = PriceSEK.parse(kronor);
      expect(parsed).toBe(ore);
      expect(Number.isInteger(parsed)).toBe(true);
    },
  );
});

describe('SafeHtml', () => {
  it('has no runtime constructor, schema or guard in @pwp/schema', () => {
    const names = [...Object.keys(primitives), ...Object.keys(root)];
    expect(names.filter((n) => /safe.?html/i.test(n))).toEqual([]);
  });

  it('is not assignable from a plain string (type-level)', () => {
    const accept = (html: SafeHtml): SafeHtml => html;
    // @ts-expect-error A plain string is not SafeHtml.
    expect(accept('<p>x</p>')).toBe('<p>x</p>');
  });
});

describe('export convention', () => {
  it('serves every schema folder as its own subpath, with no per-folder entries', () => {
    expect(pkg.exports).toEqual({ '.': './src/index.ts', './*': './src/*/index.ts' });
  });

  it('re-exports z from the root and does not re-export any folder', () => {
    expect(root.z).toBe(z);
    expect(Object.keys(root).sort()).toEqual(['PACKAGE_NAME', 'z']);
  });
});
