import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';
import {
  MAX_PAGE_DESCRIPTION_LENGTH,
  MAX_PAGE_TITLE_LENGTH,
  PageKey,
  pageFrontMatterSchema,
  type PageFrontMatter,
} from './index.js';
import * as pages from './index.js';
import { aboutEn, aboutSv, frontMatterSvEnFixtures, frontMatterSvFixtures } from './fixtures.js';
import { SINGLE_LINE_TEXT_UNSAFE, slugFixtures, type Fixtures } from '../primitives/fixtures.js';
import type { LocaleCode } from '../primitives/index.js';

const label = (value: unknown): string => String(JSON.stringify(value)).slice(0, 160);

function table(name: string, schema: z.ZodType, fixtures: Fixtures): void {
  describe(name, () => {
    it.each(fixtures.valid.map((v, i) => [i, label(v), v]))('accepts #%i %s', (_, __, value) => {
      expect(schema.safeParse(value).error?.issues).toBeUndefined();
    });
    it.each(fixtures.invalid.map((v, i) => [i, label(v), v]))('rejects #%i %s', (_, __, value) => {
      expect(schema.safeParse(value).success).toBe(false);
    });
  });
}

const SvEn = pageFrontMatterSchema({ locales: ['sv', 'en'] });
const Sv = pageFrontMatterSchema({ locales: ['sv'] });

table("pageFrontMatterSchema(['sv', 'en'])", SvEn, frontMatterSvEnFixtures);
table("pageFrontMatterSchema(['sv'])", Sv, frontMatterSvFixtures);
table('PageKey', PageKey, slugFixtures);

/** The issues of a failed parse, reduced to what the tests check. */
function issues(schema: z.ZodType, value: unknown): { path: PropertyKey[]; code: string }[] {
  const result = schema.safeParse(value);
  return (result.error?.issues ?? []).map((issue) => ({ path: issue.path, code: issue.code }));
}

describe('pages module surface', () => {
  it('exports exactly the documented names', () => {
    expect(Object.keys(pages).sort()).toEqual(
      [
        'MAX_PAGE_DESCRIPTION_LENGTH',
        'MAX_PAGE_TITLE_LENGTH',
        'PageKey',
        'pageFrontMatterSchema',
      ].sort(),
    );
    expect(MAX_PAGE_TITLE_LENGTH).toBe(120);
    expect(MAX_PAGE_DESCRIPTION_LENGTH).toBe(300);
  });

  it('is a pure factory: two contexts give independent schemas', () => {
    expect(Sv.safeParse(aboutEn).success).toBe(false);
    expect(SvEn.safeParse(aboutEn).success).toBe(true);
    expect(pageFrontMatterSchema({ locales: ['en'] }).safeParse(aboutEn).success).toBe(true);
    expect(Sv.safeParse(aboutSv).success).toBe(true);
  });

  it('ignores duplicate locales in the context', () => {
    const twice = pageFrontMatterSchema({ locales: ['sv', 'sv'] });
    expect(twice.safeParse(aboutSv).success).toBe(true);
    expect(issues(twice, aboutEn)).toEqual([{ path: ['locale'], code: 'invalid_value' }]);
  });

  it('throws at construction for an empty or unknown locale list (fails closed)', () => {
    expect(() => pageFrontMatterSchema({ locales: [] })).toThrow(TypeError);
    expect(() => pageFrontMatterSchema({ locales: ['de' as LocaleCode] })).toThrow(TypeError);
    expect(() => pageFrontMatterSchema({ locales: ['sv', 'de' as LocaleCode] })).toThrow(TypeError);
  });
});

describe('pageFrontMatterSchema output', () => {
  it('trims title and description and returns exactly the four keys', () => {
    expect(SvEn.parse({ ...aboutSv, title: '  Om oss ', description: ' Kort. ' })).toEqual({
      key: 'about',
      locale: 'sv',
      title: 'Om oss',
      description: 'Kort.',
    });
  });

  it('has the documented output type', () => {
    expectTypeOf<PageFrontMatter>().toEqualTypeOf<{
      key: string;
      locale: LocaleCode;
      title: string;
      description: string;
    }>();
  });
});

describe('one mistake gives exactly one issue', () => {
  it.each<[string, unknown, { path: PropertyKey[]; code: string }[]]>([
    ['root is not an object', 'x', [{ path: [], code: 'invalid_type' }]],
    ['unknown key', { ...aboutSv, slug: 'about' }, [{ path: [], code: 'unrecognized_keys' }]],
    [
      'key with a path',
      { ...aboutSv, key: '../about' },
      [{ path: ['key'], code: 'invalid_format' }],
    ],
    ['key too long', { ...aboutSv, key: 'a'.repeat(65) }, [{ path: ['key'], code: 'too_big' }]],
    [
      'locale not supported',
      { ...aboutSv, locale: 'de' },
      [{ path: ['locale'], code: 'invalid_value' }],
    ],
    [
      'missing title',
      { key: 'about', locale: 'sv', description: 'x' },
      [{ path: ['title'], code: 'invalid_type' }],
    ],
    ['blank title', { ...aboutSv, title: '   ' }, [{ path: ['title'], code: 'too_small' }]],
    [
      'title with a line break',
      { ...aboutSv, title: 'Om\noss' },
      [{ path: ['title'], code: 'invalid_format' }],
    ],
    [
      'title too long',
      { ...aboutSv, title: 'T'.repeat(121) },
      [{ path: ['title'], code: 'too_big' }],
    ],
    [
      'localized title',
      { ...aboutSv, title: { sv: 'Om oss' } },
      [{ path: ['title'], code: 'invalid_type' }],
    ],
    [
      'description too long',
      { ...aboutSv, description: 'D'.repeat(301) },
      [{ path: ['description'], code: 'too_big' }],
    ],
  ])('%s', (_, value, expected) => {
    expect(issues(SvEn, value)).toEqual(expected);
  });

  it.each(SINGLE_LINE_TEXT_UNSAFE.map(([name, value]) => [name, value]))(
    'a title or description with %s is one invalid_format issue (#157)',
    (_, value) => {
      expect(issues(SvEn, { ...aboutSv, title: value })).toEqual([
        { path: ['title'], code: 'invalid_format' },
      ]);
      expect(issues(SvEn, { ...aboutSv, description: value })).toEqual([
        { path: ['description'], code: 'invalid_format' },
      ]);
    },
  );

  it('a locale the tenant did not enable is one issue, not two', () => {
    expect(issues(Sv, aboutEn)).toEqual([{ path: ['locale'], code: 'invalid_value' }]);
    expect(Sv.safeParse(aboutEn).error?.issues[0]).toMatchObject({ values: ['sv'] });
  });

  it('separate mistakes are reported separately, one issue each', () => {
    expect(
      issues(Sv, { key: 'About', locale: 'en', title: '', description: 'x', draft: true }),
    ).toEqual([
      { path: ['key'], code: 'invalid_format' },
      { path: ['locale'], code: 'invalid_value' },
      { path: ['title'], code: 'too_small' },
      { path: [], code: 'unrecognized_keys' },
    ]);
  });
});
