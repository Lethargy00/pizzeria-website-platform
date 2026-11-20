import { describe, expect, it } from 'vitest';
import { HOLIDAY_IDS, swedishHolidays } from './index.js';

/**
 * Moveable holidays as printed in the official Swedish calendar tables
 * (Easter Sunday, Ascension, Whit Sunday, Midsummer Day, All Saints' Day).
 * Hard-coded independently of the implementation.
 */
const TABLE: Record<
  number,
  [easter: string, ascension: string, whit: string, midsummer: string, allSaints: string]
> = {
  2024: ['03-31', '05-09', '05-19', '06-22', '11-02'],
  2025: ['04-20', '05-29', '06-08', '06-21', '11-01'],
  2026: ['04-05', '05-14', '05-24', '06-20', '10-31'],
  2027: ['03-28', '05-06', '05-16', '06-26', '11-06'],
  2028: ['04-16', '05-25', '06-04', '06-24', '11-04'],
  2029: ['04-01', '05-10', '05-20', '06-23', '11-03'],
  2030: ['04-21', '05-30', '06-09', '06-22', '11-02'],
  2031: ['04-13', '05-22', '06-01', '06-21', '11-01'],
  2032: ['03-28', '05-06', '05-16', '06-26', '11-06'],
  2033: ['04-17', '05-26', '06-05', '06-25', '11-05'],
  2034: ['04-09', '05-18', '05-28', '06-24', '11-04'],
  2035: ['03-25', '05-03', '05-13', '06-23', '11-03'],
};

function dateOf(year: number, id: string): string | undefined {
  return swedishHolidays(year).find((h) => h.id === id)?.date;
}

describe('swedishHolidays', () => {
  for (const [yearStr, [easter, ascension, whit, midsummer, allSaints]] of Object.entries(TABLE)) {
    const year = Number(yearStr);
    it(`matches the official calendar for ${year}`, () => {
      expect(dateOf(year, 'paskdagen')).toBe(`${year}-${easter}`);
      expect(dateOf(year, 'kristi-himmelsfard')).toBe(`${year}-${ascension}`);
      expect(dateOf(year, 'pingstdagen')).toBe(`${year}-${whit}`);
      expect(dateOf(year, 'midsommardagen')).toBe(`${year}-${midsummer}`);
      expect(dateOf(year, 'alla-helgons-dag')).toBe(`${year}-${allSaints}`);
    });
  }

  it('derives Easter-relative days and eves', () => {
    // 2026: Easter 5 April.
    expect(dateOf(2026, 'langfredag')).toBe('2026-04-03');
    expect(dateOf(2026, 'paskafton')).toBe('2026-04-04');
    expect(dateOf(2026, 'annandag-pask')).toBe('2026-04-06');
    // Earliest possible Easter in the range (25 March 2035) and 2032 (28 March).
    expect(dateOf(2035, 'langfredag')).toBe('2035-03-23');
    expect(dateOf(2035, 'annandag-pask')).toBe('2035-03-26');
  });

  it('has midsommarafton on the Friday before midsommardagen', () => {
    expect(dateOf(2025, 'midsommarafton')).toBe('2025-06-20');
    expect(dateOf(2027, 'midsommarafton')).toBe('2027-06-25');
    for (let year = 2024; year <= 2035; year++) {
      const day = new Date(`${dateOf(year, 'midsommarafton')}T00:00:00Z`).getUTCDay();
      expect(day).toBe(5);
    }
  });

  it('has the fixed-date holidays', () => {
    const fixed: Record<string, string> = {
      nyarsdagen: '01-01',
      'trettondedag-jul': '01-06',
      '1-maj': '05-01',
      nationaldagen: '06-06',
      julafton: '12-24',
      juldagen: '12-25',
      'annandag-jul': '12-26',
      nyarsafton: '12-31',
    };
    for (const [id, md] of Object.entries(fixed)) {
      expect(dateOf(2028, id)).toBe(`2028-${md}`);
    }
  });

  it('returns every HolidayId exactly once, sorted by date, with sv and en names', () => {
    const list = swedishHolidays(2030);
    expect(list.map((h) => h.id).sort()).toEqual([...HOLIDAY_IDS].sort());
    expect(list.map((h) => h.date)).toEqual([...list.map((h) => h.date)].sort());
    for (const h of list) {
      expect(h.date).toMatch(/^2030-\d{2}-\d{2}$/);
      expect(h.name.sv.length).toBeGreaterThan(0);
      expect(h.name.en.length).toBeGreaterThan(0);
    }
  });

  it('is deterministic and does not share mutable state between calls', () => {
    const a = swedishHolidays(2026);
    const first = a.find((h) => h.id === 'nyarsdagen');
    if (first) first.name.sv = 'changed';
    expect(swedishHolidays(2026).find((h) => h.id === 'nyarsdagen')?.name.sv).toBe('Nyårsdagen');
  });

  it('rejects invalid years', () => {
    expect(() => swedishHolidays(2026.5)).toThrow(RangeError);
    expect(() => swedishHolidays(Number.NaN)).toThrow(RangeError);
    expect(() => swedishHolidays(1000)).toThrow(RangeError);
  });
});
