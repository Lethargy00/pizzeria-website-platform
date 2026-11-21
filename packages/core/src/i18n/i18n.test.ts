import { describe, expect, it } from 'vitest';
import { Slug } from '@pwp/schema/primitives';
import {
  formatDateRange,
  formatPrice,
  formatTime,
  hreflang,
  localize,
  slugify,
  t,
} from './index.js';

const NBSP = ' ';

describe('localize', () => {
  it('returns the requested locale', () => {
    expect(localize({ sv: 'Meny', en: 'Menu' }, 'en', 'sv')).toBe('Menu');
    expect(localize({ sv: 'Meny', en: 'Menu' }, 'sv', 'sv')).toBe('Meny');
  });

  it('falls back to the default locale', () => {
    expect(localize({ sv: 'Meny' }, 'en', 'sv')).toBe('Meny');
    expect(localize({ en: 'Menu' }, 'sv', 'en')).toBe('Menu');
  });

  it('throws when both are missing', () => {
    expect(() => localize({}, 'en', 'sv')).toThrow(/neither `en` nor `sv`/);
    expect(() => localize({ en: 'Menu' }, 'sv', 'sv')).toThrow();
  });

  it('treats an empty string as missing', () => {
    expect(localize({ sv: 'Meny', en: '' }, 'en', 'sv')).toBe('Meny');
    expect(() => localize({ sv: '', en: '' }, 'en', 'sv')).toThrow();
  });
});

describe('t', () => {
  it('falls back to sv by default', () => {
    expect(t({ sv: 'Meny' }, 'en')).toBe('Meny');
    expect(t({ sv: 'Meny', en: 'Menu' }, 'en')).toBe('Menu');
  });

  it('takes an explicit fallback and throws when nothing matches', () => {
    expect(t({ en: 'Menu' }, 'sv', 'en')).toBe('Menu');
    expect(() => t({ en: 'Menu' }, 'sv')).toThrow();
  });
});

describe('hreflang', () => {
  it('maps locales to language tags', () => {
    expect(hreflang('sv')).toBe('sv-SE');
    expect(hreflang('en')).toBe('en');
  });
});

describe('formatPrice', () => {
  it('formats whole kronor without decimals', () => {
    expect(formatPrice(12900, 'sv')).toBe(`129${NBSP}kr`);
    expect(formatPrice(12900, 'en')).toBe(`SEK${NBSP}129`);
    expect(formatPrice(0, 'sv')).toBe(`0${NBSP}kr`);
    expect(formatPrice(0, 'en')).toBe(`SEK${NBSP}0`);
  });

  it('uses a decimal comma in sv and a point in en', () => {
    expect(formatPrice(12950, 'sv')).toBe(`129,50${NBSP}kr`);
    expect(formatPrice(12950, 'en')).toBe(`SEK${NBSP}129.50`);
    expect(formatPrice(3995, 'sv')).toBe(`39,95${NBSP}kr`);
    expect(formatPrice(5, 'sv')).toBe(`0,05${NBSP}kr`);
  });

  it('groups thousands with a non-breaking space in sv', () => {
    expect(formatPrice(1_290_000, 'sv')).toBe(`12${NBSP}900${NBSP}kr`);
    expect(formatPrice(1_290_000, 'en')).toBe(`SEK${NBSP}12,900`);
  });

  it('uses only non-breaking spaces', () => {
    expect(formatPrice(1_290_050, 'sv')).not.toMatch(/ /);
  });

  it('rejects non-integers and unsafe numbers', () => {
    expect(() => formatPrice(129.5, 'sv')).toThrow(RangeError);
    expect(() => formatPrice(Number.NaN, 'sv')).toThrow(RangeError);
    expect(() => formatPrice(Infinity, 'en')).toThrow(RangeError);
  });
});

describe('formatTime', () => {
  it('shows Stockholm time on a 24-hour clock in both locales', () => {
    const winter = Date.UTC(2026, 10, 21, 17, 30); // CET, UTC+1
    expect(formatTime(winter, 'sv')).toBe('18:30');
    expect(formatTime(new Date(winter), 'en')).toBe('18:30');
  });

  it('follows daylight saving time', () => {
    const summer = Date.UTC(2026, 5, 21, 17, 30); // CEST, UTC+2
    expect(formatTime(summer, 'sv')).toBe('19:30');
  });

  it('handles the spring-forward and fall-back days', () => {
    expect(formatTime(Date.UTC(2026, 2, 29, 0, 59), 'sv')).toBe('01:59'); // before the jump
    expect(formatTime(Date.UTC(2026, 2, 29, 1, 0), 'sv')).toBe('03:00'); // 02:00 does not exist
    expect(formatTime(Date.UTC(2026, 9, 25, 0, 30), 'sv')).toBe('02:30'); // first 02:30 (CEST)
    expect(formatTime(Date.UTC(2026, 9, 25, 1, 30), 'sv')).toBe('02:30'); // second 02:30 (CET)
  });

  it('shows midnight as 00:00', () => {
    expect(formatTime(Date.UTC(2026, 10, 20, 23, 0), 'sv')).toBe('00:00');
  });

  it('accepts another time zone', () => {
    expect(formatTime(Date.UTC(2026, 10, 21, 17, 30), 'en', 'UTC')).toBe('17:30');
  });

  it('rejects an invalid date', () => {
    expect(() => formatTime(Number.NaN, 'sv')).toThrow(RangeError);
  });
});

describe('formatDateRange', () => {
  const start = Date.UTC(2026, 10, 21, 12);
  const end = Date.UTC(2026, 10, 24, 12);

  it('formats a range in each locale', () => {
    expect(formatDateRange(start, end, 'sv')).toBe('21–24 nov. 2026');
    expect(formatDateRange(start, end, 'en').replaceAll(NBSP, ' ')).toMatch(
      /^Nov 21\s[–-]\s24, 2026$/,
    );
  });

  it('formats a single day as one date', () => {
    expect(formatDateRange(start, start, 'sv')).toBe('21 nov. 2026');
  });

  it('uses Stockholm days, not UTC days', () => {
    // 23:30 UTC on 21 Nov is 00:30 on 22 Nov in Stockholm.
    expect(
      formatDateRange(Date.UTC(2026, 10, 21, 23, 30), Date.UTC(2026, 10, 21, 23, 45), 'sv'),
    ).toBe('22 nov. 2026');
  });

  it('crosses a year end', () => {
    expect(formatDateRange(Date.UTC(2026, 11, 30, 12), Date.UTC(2027, 0, 2, 12), 'sv')).toBe(
      '30 dec. 2026–2 jan. 2027',
    );
  });

  it('rejects an end before the start and invalid dates', () => {
    expect(() => formatDateRange(end, start, 'sv')).toThrow(RangeError);
    expect(() => formatDateRange(Number.NaN, end, 'sv')).toThrow(RangeError);
  });
});

describe('slugify', () => {
  it('maps å, ä, ö to a, a, o', () => {
    expect(slugify('Pizzeria Årsta Gård')).toBe('pizzeria-arsta-gard');
    expect(slugify('Öl & Älg')).toBe('ol-alg');
    expect(slugify('ÅÄÖ åäö')).toBe('aao-aao');
  });

  it('handles decomposed input the same as composed', () => {
    expect(slugify('Årsta')).toBe('arsta');
  });

  it('drops other accents and maps special letters', () => {
    expect(slugify('Crème brûlée')).toBe('creme-brulee');
    expect(slugify('Smørrebrød Straße Æble')).toBe('smorrebrod-strasse-aeble');
  });

  it('collapses separators and trims hyphens', () => {
    expect(slugify('  --Hello,   World!!  ')).toBe('hello-world');
    expect(slugify('a_b/c.d')).toBe('a-b-c-d');
  });

  it('keeps digits', () => {
    expect(slugify('Lunch 2026')).toBe('lunch-2026');
  });

  it('returns an empty string when nothing is left', () => {
    expect(slugify('')).toBe('');
    expect(slugify('***')).toBe('');
    expect(slugify('日本')).toBe('');
  });

  it('limits the length without a trailing hyphen', () => {
    const long = slugify('ab '.repeat(100));
    expect(long.length).toBeLessThanOrEqual(64);
    expect(long.endsWith('-')).toBe(false);
    expect(slugify('abc def', 4)).toBe('abc');
  });

  it('is idempotent and always satisfies Slug', () => {
    for (const text of ['Pizzeria Årsta Gård', 'Öl & Älg', 'x'.repeat(200), 'Crème Brûlée 2']) {
      const slug = slugify(text);
      expect(slugify(slug)).toBe(slug);
      expect(Slug.safeParse(slug).success).toBe(true);
    }
  });
});
