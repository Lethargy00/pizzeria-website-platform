import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  HOLIDAY_IDS,
  PACKAGE_NAME,
  swedishHolidays,
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
});
