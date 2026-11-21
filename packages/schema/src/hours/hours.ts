import { z } from 'zod';
import {
  IsoDate,
  Slug,
  TimeOfDay,
  WEEKDAYS,
  localizedStringFor,
  strictObject,
  type LocaleContext,
  type Weekday,
} from '../primitives/index.js';

/**
 * The time zone of every opening time. Fixed by DECISIONS #30 and not tenant-configurable:
 * `hours.yaml` has no time-zone key, and `strictObject` rejects one as an unknown key.
 */
export const HOURS_TIME_ZONE = 'Europe/Stockholm' as const;

/**
 * The ids of the Swedish holiday calendar: the values tenants write as `holiday:` in
 * `hours.yaml`. `@pwp/schema` owns them. `@pwp/core` imports `HOLIDAY_IDS` / `HolidayId` from
 * `@pwp/schema/hours` and keeps only the dates and names, as a `Record<HolidayId, …>`, so a
 * missing or extra id is a compile error (architect decision on PR #126, for #29 / #30; the
 * dependency already points core → schema, ADR 0001). Adding an id is additive; removing or
 * renaming one is a `type:contract` change.
 */
export const HOLIDAY_IDS = [
  'nyarsdagen',
  'trettondedag-jul',
  'langfredag',
  'paskafton',
  'paskdagen',
  'annandag-pask',
  '1-maj',
  'kristi-himmelsfard',
  'pingstdagen',
  'nationaldagen',
  'midsommarafton',
  'midsommardagen',
  'alla-helgons-dag',
  'julafton',
  'juldagen',
  'annandag-jul',
  'nyarsafton',
] as const;

export const HolidayId = z.enum(HOLIDAY_IDS);
export type HolidayId = z.infer<typeof HolidayId>;

/** Most opening intervals on one day (for example lunch and dinner, plus a late slot). */
export const MAX_INTERVALS_PER_DAY = 4;
/** Most locations in one `hours.yaml`; equal to `MAX_LOCATIONS` of `locations.yaml` (#27). */
export const MAX_HOURS_LOCATIONS = 50;
/** Most dated exceptions per location. Old ones can be deleted once they have passed. */
export const MAX_EXCEPTIONS = 100;
/** Longest exception period (`date` to `until`, both included), in days. */
export const MAX_EXCEPTION_DAYS = 366;

/*
 * Custom checks (overlaps, duplicates, `closed` or `intervals`, periods) raise a `custom` issue
 * with a full English `message` and no `pwpCode`, like `@pwp/schema/locations` (#124): the closed
 * `CUSTOM_ISSUE_CODES` list of the error contract (#23) has no code for them yet, so the mapping
 * shows the message under code `invalid`. #125 proposes `duplicate_id` and `requires_field`;
 * once codes exist, the issues here gain `params` and nothing else changes.
 */

const MINUTES_PER_DAY = 1440;

/*
 * Guards for the custom checks. In zod 4 a format failure of a field does not stop the parent's
 * `superRefine`, so a check can see a value its primitive already rejected. Every check skips such
 * values: one mistake gives exactly one issue, at the primitive's path.
 */
const isValidTime = (value: unknown): boolean => TimeOfDay.safeParse(value).success;
const isValidDate = (value: unknown): boolean => IsoDate.safeParse(value).success;
const isValidInterval = (value: unknown): value is TimeInterval =>
  typeof value === 'object' &&
  value !== null &&
  isValidTime((value as { open?: unknown }).open) &&
  isValidTime((value as { close?: unknown }).close);

function minutes(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

/**
 * When an interval is open, in minutes after midnight (local time, `Europe/Stockholm`) of the day
 * it **opens**. `start` is in `0..1439`; `end` is in `1..2880` and is exclusive.
 *
 * - `close` after `open`: the same day (`11:00`–`14:00` → 660..840).
 * - `close` at `00:00`: until midnight (`17:00`–`00:00` → 1020..1440).
 * - `close` before `open`: overnight, ends the next day (`22:00`–`02:00` → 1320..1560).
 * - `00:00`–`00:00`: the whole day (0..1440).
 *
 * The schema uses this for its overlap checks, and the opening-hours engine (#30) must use it
 * too, so both read an interval the same way. These are wall-clock minutes; the engine maps
 * them to instants (DST days are 23 or 25 hours long).
 *
 * The input must be a validated interval (both times pass `TimeOfDay`); for malformed times the
 * result is meaningless (for example `NaN`).
 */
export function intervalSpan(interval: { readonly open: string; readonly close: string }): {
  start: number;
  end: number;
} {
  const start = minutes(interval.open);
  const close = minutes(interval.close);
  return { start, end: close > start ? close : close + MINUTES_PER_DAY };
}

/**
 * One opening interval, e.g. `{ open: '11:00', close: '22:00' }`. See {@link intervalSpan} for
 * overnight hours and "until midnight". An interval belongs to the day it opens on.
 */
export const TimeInterval = strictObject({ open: TimeOfDay, close: TimeOfDay }).superRefine(
  (value, ctx) => {
    if (!isValidInterval(value)) return;
    if (value.open === value.close && value.open !== '00:00') {
      ctx.addIssue({
        code: 'custom',
        path: ['close'],
        message:
          'The interval opens and closes at the same time. For a whole day open, write `00:00` to `00:00`.',
      });
    }
  },
);
export type TimeInterval = z.output<typeof TimeInterval>;

const span = (i: TimeInterval): string => `${i.open}–${i.close}`;

/**
 * Raises an issue on every interval that overlaps an earlier one in the list. Touching intervals
 * (`11:00`–`14:00` and `14:00`–`22:00`) do not overlap.
 */
function checkOverlaps(
  intervals: readonly TimeInterval[],
  ctx: z.RefinementCtx,
  pathOf: (index: number) => (string | number)[],
): void {
  const sorted = intervals
    .map((interval, index) => ({ interval, index }))
    .filter(({ interval }) => isValidInterval(interval))
    .map(({ interval, index }) => ({ interval, index, ...intervalSpan(interval) }))
    .sort((a, b) => a.start - b.start || a.index - b.index);
  let latest: (typeof sorted)[number] | undefined;
  for (const current of sorted) {
    if (latest && current.start < latest.end) {
      ctx.addIssue({
        code: 'custom',
        path: pathOf(current.index),
        message: `The interval ${span(current.interval)} overlaps ${span(latest.interval)} on the same day.`,
      });
    }
    if (!latest || current.end > latest.end) latest = current;
  }
}

/** The intervals of one day: 0 (closed) to {@link MAX_INTERVALS_PER_DAY}, none overlapping. */
export const DayIntervals = z
  .array(TimeInterval)
  .max(MAX_INTERVALS_PER_DAY)
  .superRefine((intervals, ctx) => checkOverlaps(intervals, ctx, (index) => [index]));

/**
 * The regular week. Every weekday is required; `[]` means closed that day, so a forgotten day is
 * an error instead of a silent closure. Overnight hours that run into the next day (Sunday runs
 * into Monday) must not overlap that day's intervals.
 */
export const WeeklySchedule = strictObject({
  monday: DayIntervals,
  tuesday: DayIntervals,
  wednesday: DayIntervals,
  thursday: DayIntervals,
  friday: DayIntervals,
  saturday: DayIntervals,
  sunday: DayIntervals,
}).superRefine((week, ctx) => {
  WEEKDAYS.forEach((day, d) => {
    const next = WEEKDAYS[(d + 1) % WEEKDAYS.length] as Weekday;
    for (const interval of week[day]) {
      if (!isValidInterval(interval)) continue;
      const spill = intervalSpan(interval).end - MINUTES_PER_DAY;
      if (spill <= 0) continue;
      week[next].forEach((other, index) => {
        if (isValidInterval(other) && intervalSpan(other).start < spill) {
          ctx.addIssue({
            code: 'custom',
            path: [next, index],
            message: `The interval ${span(other)} overlaps the overnight hours ${span(interval)} from ${day}.`,
          });
        }
      });
    }
  });
});
export type WeeklySchedule = z.output<typeof WeeklySchedule>;

/** Exactly one of `closed: true` or a non-empty `intervals`. */
function checkClosedOrIntervals(
  value: {
    readonly closed?: true | undefined;
    readonly intervals?: readonly TimeInterval[] | undefined;
  },
  ctx: z.RefinementCtx,
): void {
  const hasIntervals = value.intervals !== undefined;
  if (value.closed === true && hasIntervals) {
    ctx.addIssue({
      code: 'custom',
      path: ['intervals'],
      message: 'Use either `closed: true` or `intervals`, not both.',
    });
  } else if (value.closed === undefined && !hasIntervals) {
    ctx.addIssue({
      code: 'custom',
      path: [],
      message: 'Give either `closed: true` or the opening `intervals` for this day.',
    });
  }
}

/** The fields shared by a holiday rule and a dated exception. */
function overrideShape(ctx: LocaleContext) {
  return {
    /** Closed the whole day. */
    closed: z.literal(true).optional(),
    /** Custom hours instead of the weekly ones (at least one interval; use `closed` otherwise). */
    intervals: DayIntervals.min(1).optional(),
    /** Optional announcement shown to visitors, e.g. "Closed for Christmas". */
    note: localizedStringFor(ctx.locales).optional(),
  };
}

/**
 * Hours on a Swedish holiday, by its calendar id: closed, or custom intervals. A holiday that is
 * not listed follows the weekly schedule.
 */
export function holidayRuleSchema(ctx: LocaleContext) {
  return strictObject({ holiday: HolidayId, ...overrideShape(ctx) }).superRefine(
    checkClosedOrIntervals,
  );
}

const DAY_MS = 86_400_000;
const dayNumber = (date: string): number =>
  Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) /
  DAY_MS;

/**
 * Hours on specific dates: closed, or custom intervals. `date` alone is one day; with `until`
 * (inclusive) it is a period, e.g. a summer closure. Dates are calendar dates in
 * {@link HOURS_TIME_ZONE}.
 */
export function hoursExceptionSchema(ctx: LocaleContext) {
  return strictObject({ date: IsoDate, until: IsoDate.optional(), ...overrideShape(ctx) })
    .superRefine(checkClosedOrIntervals)
    .superRefine((value, refine) => {
      if (value.until === undefined || !isValidDate(value.date) || !isValidDate(value.until)) {
        return;
      }
      const days = dayNumber(value.until) - dayNumber(value.date) + 1;
      if (days < 1) {
        refine.addIssue({
          code: 'custom',
          path: ['until'],
          message: `\`until\` (${value.until}) is before \`date\` (${value.date}).`,
        });
      } else if (days > MAX_EXCEPTION_DAYS) {
        refine.addIssue({
          code: 'custom',
          path: ['until'],
          message: `The period is ${days} days long; at most ${MAX_EXCEPTION_DAYS} days are allowed.`,
        });
      }
    });
}

/**
 * The hours of one location.
 *
 * How a day is decided (the engine, #30, implements this; the schema only guarantees the data is
 * consistent):
 * 1. A dated exception covering the day replaces that day's hours.
 * 2. Otherwise a holiday rule for a holiday on that day replaces them.
 * 3. Otherwise the weekly schedule for that weekday applies.
 *
 * "That day's hours" are the intervals that **open** on that day. Overnight hours from the
 * previous day still run until they close, even when the next day is closed by an override.
 */
export function locationHoursSchema(ctx: LocaleContext) {
  return strictObject({
    /**
     * The location's id from `locations.yaml` (#27, `LocationId`): a plain {@link Slug}, so this
     * schema does not import the locations schema. The loader (#53) checks that it exists.
     */
    location: Slug,
    weekly: WeeklySchedule,
    holidays: z
      .array(holidayRuleSchema(ctx))
      .max(HOLIDAY_IDS.length)
      .default([])
      .superRefine((rules, refine) => {
        const seen = new Set<string>();
        rules.forEach((rule, index) => {
          if (!HolidayId.safeParse(rule.holiday).success) return;
          if (seen.has(rule.holiday)) {
            refine.addIssue({
              code: 'custom',
              path: [index, 'holiday'],
              message: `The holiday \`${rule.holiday}\` is listed more than once.`,
            });
          }
          seen.add(rule.holiday);
        });
      }),
    exceptions: z
      .array(hoursExceptionSchema(ctx))
      .max(MAX_EXCEPTIONS)
      .default([])
      .superRefine((exceptions, refine) => {
        const sorted = exceptions
          .map((e, index) => ({ index, from: e.date, to: e.until ?? e.date }))
          // Skip invalid dates and backwards periods; their own issues are already raised.
          .filter((e) => isValidDate(e.from) && isValidDate(e.to) && e.to >= e.from)
          .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : a.index - b.index));
        let latest: (typeof sorted)[number] | undefined;
        for (const current of sorted) {
          if (latest && current.from <= latest.to) {
            refine.addIssue({
              code: 'custom',
              path: [current.index, 'date'],
              message: `The date ${current.from} is already covered by the exception for ${latest.from === latest.to ? latest.from : `${latest.from} to ${latest.to}`}.`,
            });
          }
          if (!latest || current.to > latest.to) latest = current;
        }
      }),
  });
}

/**
 * `hours.yaml`: opening hours per location, in {@link HOURS_TIME_ZONE}. Built for the tenant's
 * locales (ADR 0003), because exception and holiday notes are shown to visitors.
 */
export function hoursSchema(ctx: LocaleContext) {
  return strictObject({
    locations: z
      .array(locationHoursSchema(ctx))
      .min(1)
      .max(MAX_HOURS_LOCATIONS)
      .superRefine((locations, refine) => {
        const seen = new Set<string>();
        locations.forEach((entry, index) => {
          if (!Slug.safeParse(entry.location).success) return;
          if (seen.has(entry.location)) {
            refine.addIssue({
              code: 'custom',
              path: [index, 'location'],
              message: `The location \`${entry.location}\` is listed more than once.`,
            });
          }
          seen.add(entry.location);
        });
      }),
  });
}

export type Hours = z.output<ReturnType<typeof hoursSchema>>;
export type LocationHours = z.output<ReturnType<typeof locationHoursSchema>>;
export type HolidayRule = z.output<ReturnType<typeof holidayRuleSchema>>;
export type HoursException = z.output<ReturnType<typeof hoursExceptionSchema>>;
