/**
 * Valid and invalid fixtures for `@pwp/schema/hours` (#26), in input form (as parsed from
 * `hours.yaml`). Used by `hours.test.ts`; not exported from `@pwp/schema/hours`. The valid
 * documents double as mock data for the opening-hours engine (#30) and the opening-hours
 * components; expose them through a public fixtures folder in the issue that needs them
 * (ADR 0003).
 *
 * All fixtures are for the context `{ locales: ['sv', 'en'] }` unless noted.
 */
import type { LocaleContext } from '../primitives/index.js';
import type { Fixtures } from '../primitives/fixtures.js';

export const svEn: LocaleContext = { locales: ['sv', 'en'] };
export const svOnly: LocaleContext = { locales: ['sv'] };

const closed = [] as const;
const lunchDinner = [
  { open: '11:00', close: '14:00' },
  { open: '17:00', close: '22:00' },
];

/** A full week: closed Monday, split hours, overnight Friday and Saturday, until midnight Sunday. */
export const weekly = {
  monday: closed,
  tuesday: lunchDinner,
  wednesday: lunchDinner,
  thursday: [{ open: '11:00', close: '22:00' }],
  friday: [{ open: '11:00', close: '02:00' }],
  saturday: [{ open: '12:00', close: '03:00' }],
  sunday: [{ open: '13:00', close: '00:00' }],
};

/** The smallest valid document. */
export const minimalHours = {
  locations: [
    {
      location: 'centrum',
      weekly: {
        monday: [],
        tuesday: [],
        wednesday: [],
        thursday: [],
        friday: [],
        saturday: [],
        sunday: [],
      },
    },
  ],
};

/** Two locations with holiday rules and exceptions: the main mock. */
export const fullHours = {
  locations: [
    {
      location: 'centrum',
      weekly,
      holidays: [
        {
          holiday: 'julafton',
          closed: true,
          note: { sv: 'Stängt på julafton', en: 'Closed on Christmas Eve' },
        },
        { holiday: 'nyarsafton', intervals: [{ open: '12:00', close: '18:00' }] },
        { holiday: 'midsommarafton', closed: true },
      ],
      exceptions: [
        {
          date: '2026-07-06',
          until: '2026-07-26',
          closed: true,
          note: { sv: 'Sommarstängt', en: 'Closed for the summer' },
        },
        { date: '2026-10-10', intervals: [{ open: '18:00', close: '23:30' }] },
        { date: '2026-12-24', intervals: [{ open: '11:00', close: '13:00' }] },
      ],
    },
    {
      location: 'hamnen',
      weekly: { ...weekly, monday: [{ open: '00:00', close: '00:00' }] },
    },
  ],
};

const withWeekly = (patch: Record<string, unknown>) => ({
  locations: [{ location: 'centrum', weekly: { ...weekly, ...patch } }],
});
const withLocation = (patch: Record<string, unknown>) => ({
  locations: [{ location: 'centrum', weekly, ...patch }],
});

export const timeIntervalFixtures: Fixtures = {
  valid: [
    { open: '11:00', close: '22:00' },
    { open: '22:00', close: '02:00' },
    { open: '17:00', close: '00:00' },
    { open: '00:00', close: '00:00' },
    { open: '23:59', close: '00:00' },
  ],
  invalid: [
    undefined,
    null,
    '11:00-22:00',
    [],
    {},
    { open: '11:00' },
    { close: '22:00' },
    { open: '11:00', close: '24:00' },
    { open: '11', close: '22' },
    { open: '11:00', close: '22:00', days: 'mon' },
    { open: '12:00', close: '12:00' },
  ],
};

export const hoursFixtures: Fixtures = {
  valid: [
    minimalHours,
    fullHours,
    // Touching intervals do not overlap.
    withWeekly({
      tuesday: [
        { open: '11:00', close: '14:00' },
        { open: '14:00', close: '22:00' },
      ],
    }),
    // Intervals need not be in order.
    withWeekly({
      tuesday: [
        { open: '17:00', close: '22:00' },
        { open: '11:00', close: '14:00' },
      ],
    }),
    // Overnight Friday ends at 02:00, Saturday opens at 02:00.
    withWeekly({ saturday: [{ open: '02:00', close: '04:00' }] }),
    // Overnight Sunday into a closed Monday.
    withWeekly({ sunday: [{ open: '20:00', close: '03:00' }] }),
    // Exceptions that touch but do not overlap.
    withLocation({
      exceptions: [
        { date: '2026-07-01', until: '2026-07-10', closed: true },
        { date: '2026-07-11', closed: true },
      ],
    }),
    // A one-day period.
    withLocation({ exceptions: [{ date: '2026-07-01', until: '2026-07-01', closed: true }] }),
    // A whole year (leap year, 366 days).
    withLocation({ exceptions: [{ date: '2028-01-01', until: '2028-12-31', closed: true }] }),
  ],
  invalid: [
    undefined,
    null,
    [],
    'locations: []',
    {},
    { locations: [] },
    // Time zone is not configurable.
    { ...minimalHours, timeZone: 'Europe/London' },
    { locations: [{ ...minimalHours.locations[0], timeZone: 'UTC' }] },
    // Unknown keys.
    { ...minimalHours, extra: 1 },
    withLocation({ notes: 'x' }),
    // Location id.
    { locations: [{ ...minimalHours.locations[0], location: 'Centrum' }] },
    { locations: [{ ...minimalHours.locations[0], location: '../x' }] },
    // Duplicate location.
    { locations: [minimalHours.locations[0], minimalHours.locations[0]] },
    // Weekly schedule: a missing day, an unknown day, a short day name.
    { locations: [{ location: 'centrum', weekly: { ...weekly, sunday: undefined } }] },
    withWeekly({ funday: [] }),
    withWeekly({ mon: [] }),
    withWeekly({ monday: 'closed' }),
    withWeekly({ monday: null }),
    // Too many intervals.
    withWeekly({
      monday: [
        { open: '08:00', close: '09:00' },
        { open: '10:00', close: '11:00' },
        { open: '12:00', close: '13:00' },
        { open: '14:00', close: '15:00' },
        { open: '16:00', close: '17:00' },
      ],
    }),
    // Overlapping on the same day.
    withWeekly({
      tuesday: [
        { open: '11:00', close: '15:00' },
        { open: '14:00', close: '22:00' },
      ],
    }),
    withWeekly({
      tuesday: [
        { open: '11:00', close: '22:00' },
        { open: '12:00', close: '13:00' },
      ],
    }),
    withWeekly({
      tuesday: [
        { open: '11:00', close: '14:00' },
        { open: '11:00', close: '14:00' },
      ],
    }),
    withWeekly({
      tuesday: [
        { open: '18:00', close: '02:00' },
        { open: '20:00', close: '23:00' },
      ],
    }),
    withWeekly({
      tuesday: [
        { open: '00:00', close: '00:00' },
        { open: '10:00', close: '11:00' },
      ],
    }),
    // Overnight into the next day's hours.
    withWeekly({ saturday: [{ open: '01:00', close: '03:00' }] }),
    withWeekly({
      sunday: [{ open: '20:00', close: '03:00' }],
      monday: [{ open: '02:00', close: '05:00' }],
    }),
    // Same open and close.
    withWeekly({ thursday: [{ open: '10:00', close: '10:00' }] }),
    // Holiday rules.
    withLocation({ holidays: [{ holiday: 'christmas', closed: true }] }),
    withLocation({ holidays: [{ holiday: 'Julafton', closed: true }] }),
    withLocation({ holidays: [{ holiday: 'julafton' }] }),
    withLocation({ holidays: [{ holiday: 'julafton', closed: false }] }),
    withLocation({ holidays: [{ holiday: 'julafton', intervals: [] }] }),
    withLocation({
      holidays: [
        { holiday: 'julafton', closed: true, intervals: [{ open: '11:00', close: '13:00' }] },
      ],
    }),
    withLocation({
      holidays: [
        { holiday: 'julafton', closed: true },
        { holiday: 'julafton', closed: true },
      ],
    }),
    withLocation({
      holidays: [
        {
          holiday: 'julafton',
          intervals: [
            { open: '11:00', close: '14:00' },
            { open: '13:00', close: '15:00' },
          ],
        },
      ],
    }),
    withLocation({ holidays: [{ holiday: 'julafton', closed: true, note: { sv: 'Stängt' } }] }),
    withLocation({ holidays: [{ holiday: 'julafton', closed: true, note: 'Stängt' }] }),
    // Exceptions.
    withLocation({ exceptions: [{ date: '2026-02-30', closed: true }] }),
    withLocation({ exceptions: [{ date: '24/12/2026', closed: true }] }),
    withLocation({ exceptions: [{ date: '2026-12-24' }] }),
    withLocation({ exceptions: [{ closed: true }] }),
    withLocation({
      exceptions: [
        { date: '2026-12-24', closed: true },
        { date: '2026-12-24', intervals: [{ open: '11:00', close: '13:00' }] },
      ],
    }),
    withLocation({
      exceptions: [
        { date: '2026-07-01', until: '2026-07-10', closed: true },
        { date: '2026-07-10', closed: true },
      ],
    }),
    withLocation({
      exceptions: [
        { date: '2026-07-05', closed: true },
        { date: '2026-07-01', until: '2026-07-31', closed: true },
      ],
    }),
    withLocation({ exceptions: [{ date: '2026-07-10', until: '2026-07-01', closed: true }] }),
    withLocation({ exceptions: [{ date: '2026-01-01', until: '2027-01-02', closed: true }] }),
    withLocation({
      exceptions: [
        { date: '2026-12-24', closed: true, note: { sv: 'Stängt', en: 'Closed', de: 'Zu' } },
      ],
    }),
    withLocation({
      exceptions: Array.from({ length: 101 }, (_, i) => ({
        date: `2026-${String(Math.floor(i / 28) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
        closed: true,
      })),
    }),
  ],
};
