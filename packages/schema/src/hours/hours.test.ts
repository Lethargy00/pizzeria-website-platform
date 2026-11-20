import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  HOLIDAY_IDS,
  HOURS_TIME_ZONE,
  TimeInterval,
  WEEKDAYS,
  hoursSchema,
  intervalSpan,
  type Hours,
} from './index.js';
import {
  fullHours,
  hoursFixtures,
  minimalHours,
  svEn,
  svOnly,
  timeIntervalFixtures,
  weekly,
} from './fixtures.js';
import type { Fixtures } from '../primitives/fixtures.js';

const label = (value: unknown): string => String(JSON.stringify(value)).slice(0, 160);

function table(name: string, schema: z.ZodType, fixtures: Fixtures): void {
  describe(name, () => {
    it.each(fixtures.valid.map((v) => [label(v), v]))('accepts %s', (_, value) => {
      const result = schema.safeParse(value);
      expect(result.error?.issues).toBeUndefined();
    });
    it.each(fixtures.invalid.map((v) => [label(v), v]))('rejects %s', (_, value) => {
      expect(schema.safeParse(value).success).toBe(false);
    });
  });
}

table('TimeInterval', TimeInterval, timeIntervalFixtures);
table('hoursSchema(sv, en)', hoursSchema(svEn), hoursFixtures);

/** The issues of a failed parse, reduced to what the tests check. */
function issues(input: unknown, ctx = svEn) {
  const result = hoursSchema(ctx).safeParse(input);
  expect(result.success).toBe(false);
  return (result.error?.issues ?? []).map((issue) => ({
    path: issue.path,
    code: issue.code,
    pwpCode: (issue as { params?: { pwpCode?: string } }).params?.pwpCode,
  }));
}

const location = (patch: Record<string, unknown>) => ({
  locations: [{ location: 'centrum', weekly, ...patch }],
});

describe('intervalSpan', () => {
  it.each([
    [{ open: '11:00', close: '14:00' }, 660, 840],
    [{ open: '17:00', close: '00:00' }, 1020, 1440],
    [{ open: '22:00', close: '02:00' }, 1320, 1560],
    [{ open: '00:00', close: '00:00' }, 0, 1440],
    [{ open: '23:59', close: '00:00' }, 1439, 1440],
  ])('%j → %i..%i', (interval, start, end) => {
    expect(intervalSpan(interval)).toEqual({ start, end });
  });
});

describe('hoursSchema', () => {
  it('fixes the time zone to Europe/Stockholm', () => {
    expect(HOURS_TIME_ZONE).toBe('Europe/Stockholm');
    expect(issues({ ...minimalHours, timeZone: 'UTC' })).toEqual([
      { path: [], code: 'unrecognized_keys', pwpCode: undefined },
    ]);
  });

  it('lists the weekdays in ISO order', () => {
    expect(WEEKDAYS).toEqual([
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
      'sunday',
    ]);
  });

  it('uses the ids of the @pwp/core holiday calendar', () => {
    // Mirrors packages/core/src/holidays/swedish-holidays.ts; #29 / #30 assert the reverse.
    expect(HOLIDAY_IDS).toHaveLength(17);
    expect(new Set(HOLIDAY_IDS).size).toBe(HOLIDAY_IDS.length);
    expect(HOLIDAY_IDS).toContain('midsommarafton');
    expect(HOLIDAY_IDS).toContain('julafton');
    expect(HOLIDAY_IDS).toContain('nyarsafton');
  });

  it('fills in empty holidays and exceptions', () => {
    const data: Hours = hoursSchema(svEn).parse(minimalHours);
    expect(data.locations[0]?.holidays).toEqual([]);
    expect(data.locations[0]?.exceptions).toEqual([]);
  });

  it('keeps the full mock as given', () => {
    const data = hoursSchema(svEn).parse(fullHours);
    expect(data.locations).toHaveLength(2);
    expect(data.locations[0]?.weekly.friday).toEqual([{ open: '11:00', close: '02:00' }]);
    expect(data.locations[0]?.exceptions[0]).toEqual(fullHours.locations[0]?.exceptions?.[0]);
  });

  it('reports an overlap at the later interval', () => {
    const input = location({
      weekly: {
        ...weekly,
        tuesday: [
          { open: '14:00', close: '22:00' },
          { open: '11:00', close: '15:00' },
        ],
      },
    });
    expect(issues(input)).toEqual([
      {
        path: ['locations', 0, 'weekly', 'tuesday', 0],
        code: 'custom',
        pwpCode: undefined,
      },
    ]);
  });

  it('reports overnight hours that run into the next day', () => {
    const input = location({
      weekly: { ...weekly, saturday: [{ open: '01:00', close: '03:00' }] },
    });
    expect(issues(input)).toEqual([
      {
        path: ['locations', 0, 'weekly', 'saturday', 0],
        code: 'custom',
        pwpCode: undefined,
      },
    ]);
  });

  it('wraps Sunday into Monday', () => {
    const input = location({
      weekly: {
        ...weekly,
        sunday: [{ open: '22:00', close: '04:00' }],
        monday: [{ open: '03:00', close: '05:00' }],
      },
    });
    expect(issues(input)).toEqual([
      {
        path: ['locations', 0, 'weekly', 'monday', 0],
        code: 'custom',
        pwpCode: undefined,
      },
    ]);
  });

  it('requires every weekday', () => {
    const sixDays: Partial<typeof weekly> = { ...weekly };
    delete sixDays.sunday;
    expect(issues(location({ weekly: sixDays }))).toEqual([
      { path: ['locations', 0, 'weekly', 'sunday'], code: 'invalid_type', pwpCode: undefined },
    ]);
  });

  it('rejects a holiday that is not in the calendar', () => {
    expect(issues(location({ holidays: [{ holiday: 'christmas', closed: true }] }))).toEqual([
      {
        path: ['locations', 0, 'holidays', 0, 'holiday'],
        code: 'invalid_value',
        pwpCode: undefined,
      },
    ]);
  });

  it('requires exactly one of closed and intervals', () => {
    expect(issues(location({ holidays: [{ holiday: 'julafton' }] }))).toEqual([
      { path: ['locations', 0, 'holidays', 0], code: 'custom', pwpCode: undefined },
    ]);
    const both = { closed: true, intervals: [{ open: '11:00', close: '13:00' }] };
    expect(issues(location({ exceptions: [{ date: '2026-12-24', ...both }] }))).toEqual([
      {
        path: ['locations', 0, 'exceptions', 0, 'intervals'],
        code: 'custom',
        pwpCode: undefined,
      },
    ]);
  });

  it('reports duplicates', () => {
    const rule = { holiday: 'julafton', closed: true };
    expect(issues(location({ holidays: [rule, rule] }))).toEqual([
      {
        path: ['locations', 0, 'holidays', 1, 'holiday'],
        code: 'custom',
        pwpCode: undefined,
      },
    ]);
    const entry = minimalHours.locations[0];
    expect(issues({ locations: [entry, entry] })).toEqual([
      { path: ['locations', 1, 'location'], code: 'custom', pwpCode: undefined },
    ]);
  });

  it('reports exceptions that cover the same date', () => {
    const input = location({
      exceptions: [
        { date: '2026-07-20', closed: true },
        { date: '2026-07-01', until: '2026-07-31', closed: true },
      ],
    });
    expect(issues(input)).toEqual([
      {
        path: ['locations', 0, 'exceptions', 0, 'date'],
        code: 'custom',
        pwpCode: undefined,
      },
    ]);
  });

  it('checks the exception period', () => {
    const backwards = { date: '2026-07-10', until: '2026-07-01', closed: true };
    expect(issues(location({ exceptions: [backwards] }))).toEqual([
      {
        path: ['locations', 0, 'exceptions', 0, 'until'],
        code: 'custom',
        pwpCode: undefined,
      },
    ]);
  });

  it('reports a missing translation of a note', () => {
    const note = { sv: 'Stängt' };
    expect(issues(location({ exceptions: [{ date: '2026-12-24', closed: true, note }] }))).toEqual([
      {
        path: ['locations', 0, 'exceptions', 0, 'note', 'en'],
        code: 'custom',
        pwpCode: 'missing_locale',
      },
    ]);
  });

  it('is built for the tenant locales', () => {
    const input = location({
      exceptions: [{ date: '2026-12-24', closed: true, note: { sv: 'Stängt' } }],
    });
    expect(hoursSchema(svOnly).safeParse(input).success).toBe(true);
    expect(hoursSchema(svEn).safeParse(input).success).toBe(false);
  });

  it('writes a readable message on every custom issue', () => {
    const result = hoursSchema(svEn).safeParse(
      location({
        weekly: {
          ...weekly,
          tuesday: [
            { open: '11:00', close: '15:00' },
            { open: '14:00', close: '22:00' },
          ],
        },
      }),
    );
    const issue = result.error?.issues[0];
    expect(issue?.message).toBe('The interval 14:00–22:00 overlaps 11:00–15:00 on the same day.');
  });

  it('writes a full sentence on every custom issue without a pwpCode', () => {
    let count = 0;
    for (const input of hoursFixtures.invalid) {
      for (const issue of hoursSchema(svEn).safeParse(input).error?.issues ?? []) {
        if (issue.code !== 'custom') continue;
        const code = (issue as { params?: { pwpCode?: string } }).params?.pwpCode;
        if (code !== undefined) {
          expect(code).toBe('missing_locale');
          continue;
        }
        count += 1;
        expect(issue.message).toMatch(/^[A-Z`].*\.$/);
        expect(issue.message).not.toMatch(/^Invalid input/);
      }
    }
    expect(count).toBeGreaterThan(10);
  });
});
