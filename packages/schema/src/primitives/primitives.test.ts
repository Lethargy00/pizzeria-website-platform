import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import * as primitives from './index.js';
import {
  AssetRef,
  Email,
  FontRef,
  ImageRef,
  IsoDate,
  IsoDateTime,
  MAX_ISO_DATE_TIME_LENGTH,
  LocaleCode,
  LocalizedString,
  LocalizedText,
  MAX_LOCALIZED_TEXT_LENGTH,
  PhoneNumber,
  PriceSEK,
  SafeUrl,
  Slug,
  TimeOfDay,
  WEEKDAYS,
  Weekday,
  isSafeAssetPath,
  isSafeUrl,
  localizedStringFor,
  singleLineText,
  strictObject,
  type SafeHtml,
} from './index.js';
import {
  assetRefFixtures,
  emailFixtures,
  isoDateFixtures,
  isoDateTimeFixtures,
  localeCodeFixtures,
  localizedStringAnyFixtures,
  localizedStringSvEnFixtures,
  localizedStringSvFixtures,
  LOCALIZED_TEXT_UNSAFE,
  localizedTextFixtures,
  phoneNumberFixtures,
  priceSEKFixtures,
  safeUrlFixtures,
  SINGLE_LINE_TEXT_UNSAFE,
  singleLineTextFixtures,
  slugFixtures,
  TEXT_UNSAFE,
  timeOfDayFixtures,
  weekdayFixtures,
  type Fixtures,
} from './fixtures.js';
import { localizedLineFor } from './locale.js';
import * as hours from '../hours/index.js';
import * as menu from '../menu/index.js';
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
table('Weekday', Weekday, weekdayFixtures);

describe('WEEKDAYS', () => {
  it('pins the seven days in ISO order (Monday first)', () => {
    expect(WEEKDAYS).toEqual([
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
      'sunday',
    ]);
    expect(Weekday.options).toEqual([...WEEKDAYS]);
  });

  it('maps a JavaScript getDay() value to its id', () => {
    const ids = [0, 1, 2, 3, 4, 5, 6].map((jsDay) => WEEKDAYS[(jsDay + 6) % 7]);
    expect(ids).toEqual([
      'sunday',
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
    ]);
  });

  it('is the one list that hours and menu re-export', () => {
    expect(hours.WEEKDAYS).toBe(WEEKDAYS);
    expect(menu.WEEKDAYS).toBe(WEEKDAYS);
    expect(menu.Weekday).toBe(Weekday);
  });
});

table('IsoDateTime', IsoDateTime, isoDateTimeFixtures);

describe('IsoDateTime (#145)', () => {
  it('accepts what Date#toISOString() produces, and round-trips it', () => {
    const value = new Date(Date.UTC(2026, 10, 21, 4, 0, 0, 7)).toISOString();
    expect(value).toBe('2026-11-21T04:00:00.007Z');
    expect(IsoDateTime.parse(value)).toBe(value);
    expect(new Date(value).toISOString()).toBe(value);
  });

  it('bounds the length through the pattern', () => {
    expect('2026-11-21T04:00:00.000Z').toHaveLength(MAX_ISO_DATE_TIME_LENGTH);
  });

  it.each([
    ['an offset', '2026-11-21T04:00:00+01:00'],
    ['local time', '2026-11-21T04:00:00'],
    ['a date only', '2026-11-21'],
    ['an impossible date', '2026-02-30T00:00:00Z'],
    ['a leap second', '2026-12-31T23:59:60Z'],
    ['two fraction digits', '2026-11-21T04:00:00.12Z'],
    ['a very long fraction', `2026-11-21T04:00:00.${'1'.repeat(1000)}Z`],
  ])('raises exactly one invalid_format issue for %s', (_, value) => {
    expect(IsoDateTime.safeParse(value).error?.issues).toEqual([
      expect.objectContaining({ code: 'invalid_format', format: 'datetime', path: [] }),
    ]);
  });

  it('raises exactly one invalid_type issue for a non-string', () => {
    expect(IsoDateTime.safeParse(1_763_640_000).error?.issues).toEqual([
      expect.objectContaining({ code: 'invalid_type', expected: 'string', path: [] }),
    ]);
  });
});
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

table('singleLineText(20)', singleLineText(20), singleLineTextFixtures);

describe('singleLineText (#157)', () => {
  const Line = singleLineText(20);

  it('trims and returns the text unchanged otherwise', () => {
    expect(Line.parse('  Om oss  ')).toBe('Om oss');
    expect(Line.parse('\u00a0Pizza ❤️\ufeff')).toBe('Pizza ❤️');
  });

  it('counts the limit after trimming', () => {
    expect(Line.parse(` ${'x'.repeat(20)} `)).toBe('x'.repeat(20));
  });

  it.each(SINGLE_LINE_TEXT_UNSAFE.map(([name, value]) => [name, value]))(
    'raises exactly one invalid_format issue for %s',
    (_, value) => {
      expect(Line.safeParse(value).error?.issues).toEqual([
        expect.objectContaining({ code: 'invalid_format', format: 'regex', path: [] }),
      ]);
    },
  );

  it.each([
    ['empty', ''],
    ['spaces only', '   '],
    ['no-break spaces only', '\u00a0\u00a0'],
    ['a line break only (trimmed away)', '\r\n'],
  ])('raises exactly one too_small issue for %s', (_, value) => {
    expect(Line.safeParse(value).error?.issues).toEqual([
      expect.objectContaining({ code: 'too_small', minimum: 1, path: [] }),
    ]);
  });

  it('raises exactly one too_big issue for a long but clean value', () => {
    expect(Line.safeParse('x'.repeat(21)).error?.issues).toEqual([
      expect.objectContaining({ code: 'too_big', maximum: 20, path: [] }),
    ]);
  });

  it('reports a long value with a control character as two separate mistakes', () => {
    expect(Line.safeParse(`${'x'.repeat(21)}\u0000`).error?.issues).toEqual([
      expect.objectContaining({ code: 'too_big', path: [] }),
      expect.objectContaining({ code: 'invalid_format', path: [] }),
    ]);
  });

  it('raises exactly one invalid_type issue for a non-string', () => {
    expect(Line.safeParse(42).error?.issues).toEqual([
      expect.objectContaining({ code: 'invalid_type', expected: 'string', path: [] }),
    ]);
  });

  it('is linear on long hostile input', () => {
    const start = Date.now();
    expect(singleLineText(100_000).safeParse(`${'a '.repeat(40_000)}\u0000`).success).toBe(false);
    expect(Date.now() - start).toBeLessThan(500);
  });
});

describe('singleLineText blank look-alikes, unassigned and combining marks (#194)', () => {
  const Line = singleLineText(20);

  it('allows up to four combining marks in a row and rejects the fifth', () => {
    expect(Line.safeParse(`a${'\u0301'.repeat(4)}`).success).toBe(true);
    expect(Line.safeParse(`a${'\u0301'.repeat(4)}b${'\u0301'.repeat(4)}`).success).toBe(true);
    expect(Line.safeParse(`a${'\u0301'.repeat(5)}`).success).toBe(false);
  });

  it('rejects all 66 noncharacters with one invalid_format issue each', () => {
    const noncharacters = [
      ...Array.from({ length: 32 }, (_, i) => 0xfdd0 + i),
      ...Array.from({ length: 17 }, (_, plane) => [
        plane * 0x10000 + 0xfffe,
        plane * 0x10000 + 0xffff,
      ]).flat(),
    ];
    expect(noncharacters).toHaveLength(66);
    for (const cp of noncharacters) {
      expect(Line.safeParse(`a${String.fromCodePoint(cp)}b`).error?.issues).toEqual([
        expect.objectContaining({ code: 'invalid_format', format: 'regex', path: [] }),
      ]);
    }
  });

  it('accepts the code points next to the noncharacter ranges', () => {
    // U+FDCF and U+FDF0 are assigned Arabic symbols; U+FFFD is the replacement character.
    expect(Line.safeParse('a\ufdcfb').success).toBe(true);
    expect(Line.safeParse('a\ufdf0b').success).toBe(true);
    expect(Line.safeParse('a\ufffdb').success).toBe(true);
  });

  // A quadratic rule would need about 1e12 steps here, so 2 s still tells linear from not.
  const LONG = 1_000_000;
  it.each([
    ['only combining marks', '\u0301'.repeat(LONG)],
    [
      'runs of four marks, then a fifth at the end',
      `${`a${'\u0301'.repeat(4)}`.repeat(LONG / 5)}\u0301`,
    ],
    [
      'runs of four marks between spaces, then U+FFFF',
      `${`${'\u0301'.repeat(4)} `.repeat(LONG / 5)}a\uffff`,
    ],
    ['only Hangul fillers', '\u3164'.repeat(LONG)],
    ['only Braille blanks', '\u2800'.repeat(LONG)],
    ['words, then a noncharacter at the end', `${'a '.repeat(LONG / 2)}\uffff`],
    ['words, then a private-use character at the end', `${'a '.repeat(LONG / 2)}\ue000`],
    ['marks then spaces, no visible character', `${'\u0301'.repeat(4)}${' '.repeat(LONG)}`],
  ])('is linear on 1e6 characters of %s', (_, value) => {
    const start = Date.now();
    expect(singleLineText(2 * LONG).safeParse(value).success).toBe(false);
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it('is linear on 1e6 characters of valid text with many short mark runs', () => {
    const start = Date.now();
    const value = `${'a\u0301\u0301\u0301\u0301 '.repeat(LONG / 6)}x`;
    expect(singleLineText(2 * LONG).safeParse(value).success).toBe(true);
    expect(Date.now() - start).toBeLessThan(2000);
  });
});

describe('singleLineText invisible marks and variation selectors (#207)', () => {
  const Line = singleLineText(20);

  it('accepts real Burmese words with five marks on one letter', () => {
    // The word for "hope": one letter, three spacing marks (Mc) and two nonspacing ones (Mn).
    const hope = '\u1019\u103b\u103e\u1031\u102c\u103a';
    expect(Line.parse(hope)).toBe(hope);
    expect(Line.safeParse(`${hope}\u101c\u1004\u1037\u103a`).success).toBe(true);
  });

  it('counts only nonspacing and enclosing marks toward the run limit', () => {
    // Four Mn, then a spacing mark (Mc), then four Mn again: two runs of four.
    expect(
      Line.safeParse('\u0915\u0941\u0941\u0941\u0941\u093e\u0941\u0941\u0941\u0941').success,
    ).toBe(true);
    expect(Line.safeParse(`a${'\u1031'.repeat(8)}`).success).toBe(true);
    expect(Line.safeParse(`a${'\u0301'.repeat(5)}`).success).toBe(false);
    expect(Line.safeParse(`a${'\u20dd'.repeat(5)}`).success).toBe(false);
  });

  it.each([
    ['CGJ U+034F', 0x034f],
    ['Khmer U+17B4', 0x17b4],
    ['Khmer U+17B5', 0x17b5],
    ['null notehead U+1D159', 0x1d159],
    ['Khitan filler U+16FE4', 0x16fe4],
  ])('rejects %s after, inside, before and without a word', (_, cp) => {
    const mark = String.fromCodePoint(cp);
    for (const value of [`Roma${mark}`, `Ro${mark}ma`, `${mark}Roma`, mark]) {
      expect(Line.safeParse(value).error?.issues).toEqual([
        expect.objectContaining({ code: 'invalid_format', format: 'regex', path: [] }),
      ]);
    }
  });

  it('rejects every variation selector after a plain word', () => {
    const selectors = [
      ...Array.from({ length: 16 }, (_, i) => 0xfe00 + i),
      ...Array.from({ length: 240 }, (_, i) => 0xe0100 + i),
    ];
    for (const cp of selectors) {
      expect(Line.safeParse(`Roma${String.fromCodePoint(cp)}`).success).toBe(false);
    }
  });

  it('accepts U+FE0E and U+FE0F only after an emoji base, and U+FE0F only in a keycap', () => {
    expect(Line.safeParse('\u2764\ufe0f').success).toBe(true);
    expect(Line.safeParse('\u2764\ufe0e').success).toBe(true);
    expect(Line.safeParse('\u2615\ufe0f').success).toBe(true);
    expect(Line.safeParse('\u{1f355}\ufe0f').success).toBe(true);
    expect(Line.safeParse('1\ufe0f\u20e3').success).toBe(true);
    expect(Line.safeParse('1\u20e3').success).toBe(true);
    expect(Line.safeParse('1\ufe0f').success).toBe(false);
    expect(Line.safeParse('1\ufe0e\u20e3').success).toBe(false);
    expect(Line.safeParse('\u2764\ufe00').success).toBe(false);
    expect(Line.safeParse('\u2764\ufe0f\ufe0f').success).toBe(false);
  });

  it('accepts Mongolian free variation selectors only after a Mongolian character', () => {
    expect(Line.safeParse('\u1820\u180b\u1821').success).toBe(true);
    expect(Line.safeParse('\u1820\u180f').success).toBe(true);
    expect(Line.safeParse('a\u180b').success).toBe(false);
    expect(Line.safeParse('\u180b\u1820').success).toBe(false);
  });

  const LONG = 1_000_000;
  it.each([
    ['words, then a CGJ at the end', `${'a '.repeat(LONG / 2)}\u034f`],
    ['words, then U+1D159 at the end', `${'a '.repeat(LONG / 2)}\u{1d159}`],
    ['only Khmer U+17B4', '\u17b4'.repeat(LONG)],
    ['only VS16', '\ufe0f'.repeat(LONG)],
    ['digits with VS16 and no keycap', '1\ufe0f'.repeat(LONG / 2)],
    ['emoji with VS16, then a VS1 at the end', `${'\u2764\ufe0f'.repeat(LONG / 2)}\ufe00`],
    [
      'Burmese, then five marks at the end',
      `${'\u1019\u103b\u103e\u1031\u102c\u103a'.repeat(LONG / 6)}a${'\u0301'.repeat(5)}`,
    ],
  ])('is linear on 1e6 characters of %s', (_, value) => {
    const start = Date.now();
    expect(singleLineText(2 * LONG).safeParse(value).success).toBe(false);
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it.each([
    ['emoji with VS16', '\u2764\ufe0f '.repeat(LONG / 3)],
    ['keycaps', '1\ufe0f\u20e3'.repeat(LONG / 3)],
    ['Burmese words', '\u1019\u103b\u103e\u1031\u102c\u103a '.repeat(LONG / 7)],
  ])('is linear on 1e6 characters of valid %s', (_, value) => {
    const start = Date.now();
    expect(singleLineText(2 * LONG).safeParse(value).success).toBe(true);
    expect(Date.now() - start).toBeLessThan(2000);
  });
});

table('LocalizedText', LocalizedText, localizedTextFixtures);

describe('LocalizedText character rules (#188)', () => {
  const formatIssue = expect.objectContaining({
    code: 'invalid_format',
    format: 'regex',
    path: [],
  });
  const two = 'Rad ett\nRad tv\u00e5';

  it('keeps line feeds inside the text and trims the ends', () => {
    expect(LocalizedText.parse(two)).toBe(two);
    expect(LocalizedText.parse('\n  Stycke ett.\n\nStycke tv\u00e5.\n ')).toBe(
      'Stycke ett.\n\nStycke tv\u00e5.',
    );
  });

  it.each([...TEXT_UNSAFE, ...LOCALIZED_TEXT_UNSAFE].map(([name, value]) => [name, value]))(
    'raises exactly one invalid_format issue for %s',
    (_, value) => {
      expect(LocalizedText.safeParse(value).error?.issues).toEqual([formatIssue]);
    },
  );

  it('rejects every C0 and C1 control except LF, with one issue each', () => {
    const controls = Array.from({ length: 0xa0 }, (_, cp) => cp).filter((cp) =>
      /\p{Cc}/u.test(String.fromCodePoint(cp)),
    );
    // \p{Cc} is fixed by Unicode: U+0000 to U+001F and U+007F to U+009F.
    expect(controls).toHaveLength(65);
    for (const cp of controls) {
      const value = `a${String.fromCodePoint(cp)}b`;
      if (cp === 0x0a) {
        expect(LocalizedText.safeParse(value).success).toBe(true);
      } else {
        expect(LocalizedText.safeParse(value).error?.issues, `U+${cp.toString(16)}`).toEqual([
          formatIssue,
        ]);
      }
      expect(singleLineText(20).safeParse(value).error?.issues).toEqual([formatIssue]);
    }
  });

  it.each([
    ['empty', ''],
    ['spaces only', '   '],
    ['line feeds only (trimmed away)', '\n\n'],
    ['spaces and line feeds only', ' \n \n '],
  ])('raises exactly one too_small issue for %s', (_, value) => {
    expect(LocalizedText.safeParse(value).error?.issues).toEqual([
      expect.objectContaining({ code: 'too_small', minimum: 1, path: [] }),
    ]);
  });

  it('raises exactly one too_big issue for a long but clean value', () => {
    expect(LocalizedText.safeParse('x\n'.repeat(1001)).error?.issues).toEqual([
      expect.objectContaining({ code: 'too_big', maximum: MAX_LOCALIZED_TEXT_LENGTH, path: [] }),
    ]);
  });

  it('raises exactly one invalid_type issue for a non-string', () => {
    expect(LocalizedText.safeParse(42).error?.issues).toEqual([
      expect.objectContaining({ code: 'invalid_type', expected: 'string', path: [] }),
    ]);
  });

  it('ends a run of marks at a line break, and rejects a selector right after one', () => {
    const marks = (n: number) => '\u0301'.repeat(n);
    expect(LocalizedText.safeParse(`a${marks(4)}\nb${marks(4)}`).success).toBe(true);
    expect(LocalizedText.safeParse(`a${marks(5)}\nb`).success).toBe(false);
    expect(LocalizedText.safeParse('\u2764\ufe0f\n\u2615\ufe0f').success).toBe(true);
    expect(LocalizedText.safeParse('\u2764\n\ufe0f').success).toBe(false);
    expect(LocalizedText.safeParse('\u1820\n\u180b').success).toBe(false);
  });

  it('rejects ZWJ emoji and tag-sequence flags, and accepts single emoji', () => {
    // The #188 trade-off: joiners and tag characters are rejected in every text rule.
    for (const value of [
      'Kock \u{1f9d1}\u200d\u{1f373}',
      '\u{1f3f4}\u{e0067}\u{e0062}\u{e0073}\u{e0063}\u{e0074}\u{e007f}',
    ]) {
      expect(LocalizedText.safeParse(value).error?.issues).toEqual([formatIssue]);
      expect(singleLineText(20).safeParse(value).error?.issues).toEqual([formatIssue]);
    }
    expect(LocalizedText.safeParse('Kock \u{1f9d1} \u{1f373} \u{1f355}').success).toBe(true);
  });

  // A quadratic rule would need about 1e12 steps here, so 2 s still tells linear from not. The
  // length limit does not stop the regex from running, so long input must stay linear too.
  const LONG = 1_000_000;
  it.each([
    ['lines, then a NUL at the end', `${'a\n'.repeat(LONG / 2)}\u0000`],
    ['only line feeds, then a zero-width space', `${'\n'.repeat(LONG)}\u200bx`],
    [
      'lines of four marks, then a fifth at the end',
      `${`a${'\u0301'.repeat(4)}\n`.repeat(LONG / 6)}a${'\u0301'.repeat(5)}`,
    ],
    ['only line feeds and blank look-alikes', '\u3164\n'.repeat(LONG / 2)],
    ['emoji lines, then a misplaced selector', `${'\u2764\ufe0f\n'.repeat(LONG / 3)}\ufe0f`],
  ])('is linear on 1e6 characters of %s', (_, value) => {
    const start = Date.now();
    expect(LocalizedText.safeParse(value).error?.issues).toContainEqual(formatIssue);
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it('applies to every translation of a localized string, with one issue at its path', () => {
    const SvEn = localizedStringFor(['sv', 'en']);
    expect(SvEn.parse({ sv: two, en: 'Line one\nLine two' })).toEqual({
      sv: two,
      en: 'Line one\nLine two',
    });
    for (const [, value] of TEXT_UNSAFE) {
      expect(SvEn.safeParse({ sv: 'Meny', en: value }).error?.issues).toEqual([
        expect.objectContaining({ code: 'invalid_format', format: 'regex', path: ['en'] }),
      ]);
    }
    expect(LocalizedString.safeParse({ sv: 'a\u202eb' }).error?.issues).toEqual([
      expect.objectContaining({ code: 'invalid_format', path: ['sv'] }),
    ]);
  });
});

describe('localizedLineFor (#188)', () => {
  const Line = localizedLineFor(['sv', 'en'], 20);

  it('accepts and trims one line per locale', () => {
    expect(Line.parse({ sv: '  Karta ', en: 'Map' })).toEqual({ sv: 'Karta', en: 'Map' });
  });

  it.each(SINGLE_LINE_TEXT_UNSAFE.map(([name, value]) => [name, value]))(
    'raises exactly one invalid_format issue at the locale for %s',
    (_, value) => {
      expect(Line.safeParse({ sv: 'Karta', en: value }).error?.issues).toEqual([
        expect.objectContaining({ code: 'invalid_format', format: 'regex', path: ['en'] }),
      ]);
    },
  );

  it('accepts every valid singleLineText(20) value', () => {
    for (const value of singleLineTextFixtures.valid) {
      expect(Line.safeParse({ sv: value, en: value }).success, JSON.stringify(value)).toBe(true);
    }
  });

  it('uses the given limit', () => {
    expect(Line.safeParse({ sv: 'x'.repeat(20), en: 'x' }).success).toBe(true);
    expect(Line.safeParse({ sv: 'x'.repeat(21), en: 'x' }).error?.issues).toEqual([
      expect.objectContaining({ code: 'too_big', maximum: 20, path: ['sv'] }),
    ]);
  });

  it('reports blank, missing and unknown locales like localizedStringFor', () => {
    expect(Line.safeParse({ sv: ' ', en: 'Map' }).error?.issues).toEqual([
      expect.objectContaining({ code: 'too_small', path: ['sv'] }),
    ]);
    expect(Line.safeParse({ sv: 'Karta' }).error?.issues).toEqual([
      expect.objectContaining({
        code: 'custom',
        path: ['en'],
        params: { pwpCode: 'missing_locale', locale: 'en' },
      }),
    ]);
    const SvOnly = localizedLineFor(['sv'], 20);
    expect(SvOnly.safeParse({ sv: 'Karta', en: 'Map' }).error?.issues).toEqual([
      expect.objectContaining({ code: 'unrecognized_keys', keys: ['en'] }),
    ]);
  });

  it('rejects a line break that localizedStringFor accepts', () => {
    const value = { sv: 'Karta\nnorr', en: 'Map' };
    expect(localizedStringFor(['sv', 'en']).safeParse(value).success).toBe(true);
    expect(Line.safeParse(value).error?.issues).toEqual([
      expect.objectContaining({ code: 'invalid_format', path: ['sv'] }),
    ]);
  });
});

describe('text rule building blocks (#188)', () => {
  it('are not exported from @pwp/schema/primitives', () => {
    const names = Object.keys(primitives);
    for (const internal of ['textRuleSource', 'NOT_IN_TEXT', 'NOT_IN_A_LINE', 'UNSAFE_ANYWHERE']) {
      expect(names).not.toContain(internal);
    }
  });
});

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

describe('Email issues', () => {
  it.each([
    'nope',
    `${'a'.repeat(65)}@b.se`,
    'a@-b.se',
    'a@b-.se',
    'a@x.-b.se',
    'info@roma.se\nBcc: x@evil.example',
  ])('raises exactly one invalid_format issue for %j', (value) => {
    const result = Email.safeParse(value);
    expect(result.success).toBe(false);
    expect(
      result.error?.issues.map((i) => ({
        code: i.code,
        format: (i as { format?: string }).format,
      })),
    ).toEqual([{ code: 'invalid_format', format: 'email' }]);
  });

  it('is linear on long hostile input', () => {
    const start = Date.now();
    for (const value of [`a@${'a-'.repeat(50_000)}!`, `${'a.'.repeat(50_000)}@b.se`]) {
      expect(Email.safeParse(value).success).toBe(false);
    }
    expect(Date.now() - start).toBeLessThan(500);
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
