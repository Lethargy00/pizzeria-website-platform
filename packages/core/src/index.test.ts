import { describe, expect, expectTypeOf, it } from 'vitest';
import * as i18n from './i18n/index.js';
import {
  DISPLAY_TIME_ZONE,
  FALLBACK_LOCALE,
  HOLIDAY_IDS,
  PACKAGE_NAME,
  formatDateRange,
  formatPrice,
  formatTime,
  hreflang,
  localize,
  slugify,
  swedishHolidays,
  t,
  type HolidayId,
  type SwedishHoliday,
} from './index.js';

describe('@pwp/core', () => {
  it('is wired into the test runner', () => {
    expect(PACKAGE_NAME).toBe('@pwp/core');
  });

  it('re-exports the holidays module from the package root', () => {
    expect(typeof swedishHolidays).toBe('function');
    expect(HOLIDAY_IDS).toContain('midsommarafton');

    const holidays = swedishHolidays(2026);
    expect(holidays.length).toBeGreaterThan(0);
    const first: SwedishHoliday | undefined = holidays[0];
    expect(first).toBeDefined();
    const id: HolidayId | undefined = first?.id;
    expect(id).toBeDefined();
    expect(HOLIDAY_IDS).toContain(id);
    expectTypeOf<HolidayId>().toEqualTypeOf<(typeof HOLIDAY_IDS)[number]>();
  });

  it('re-exports the i18n helpers from the package root', () => {
    expect(DISPLAY_TIME_ZONE).toBe(i18n.DISPLAY_TIME_ZONE);
    expect(FALLBACK_LOCALE).toBe(i18n.FALLBACK_LOCALE);
    expect(formatDateRange).toBe(i18n.formatDateRange);
    expect(formatPrice).toBe(i18n.formatPrice);
    expect(formatTime).toBe(i18n.formatTime);
    expect(hreflang).toBe(i18n.hreflang);
    expect(localize).toBe(i18n.localize);
    expect(slugify).toBe(i18n.slugify);
    expect(t).toBe(i18n.t);
  });

  it('serves the i18n helpers from the package root with working behaviour', () => {
    expect(FALLBACK_LOCALE).toBe('sv');
    expect(DISPLAY_TIME_ZONE).toBe('Europe/Stockholm');
    expect(localize({ sv: 'Meny', en: 'Menu' }, 'en', 'sv')).toBe('Menu');
    expect(formatPrice(12900, 'sv')).toBe('129 kr');
    expect(slugify('Pizzeria Årsta Gård')).toBe('pizzeria-arsta-gard');
  });
});
