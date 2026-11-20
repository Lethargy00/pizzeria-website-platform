/** Swedish public holidays and eves as pure data. No I/O, no dependencies. */

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

export type HolidayId = (typeof HOLIDAY_IDS)[number];

export interface SwedishHoliday {
  id: HolidayId;
  /** Calendar date as `YYYY-MM-DD` (no time zone involved). */
  date: string;
  name: { sv: string; en: string };
}

const NAMES: Record<HolidayId, { sv: string; en: string }> = {
  nyarsdagen: { sv: 'Nyårsdagen', en: "New Year's Day" },
  'trettondedag-jul': { sv: 'Trettondedag jul', en: 'Epiphany' },
  langfredag: { sv: 'Långfredagen', en: 'Good Friday' },
  paskafton: { sv: 'Påskafton', en: 'Easter Eve' },
  paskdagen: { sv: 'Påskdagen', en: 'Easter Sunday' },
  'annandag-pask': { sv: 'Annandag påsk', en: 'Easter Monday' },
  '1-maj': { sv: 'Första maj', en: 'May Day' },
  'kristi-himmelsfard': { sv: 'Kristi himmelsfärdsdag', en: 'Ascension Day' },
  pingstdagen: { sv: 'Pingstdagen', en: 'Whit Sunday' },
  nationaldagen: { sv: 'Sveriges nationaldag', en: 'National Day of Sweden' },
  midsommarafton: { sv: 'Midsommarafton', en: 'Midsummer Eve' },
  midsommardagen: { sv: 'Midsommardagen', en: 'Midsummer Day' },
  'alla-helgons-dag': { sv: 'Alla helgons dag', en: "All Saints' Day" },
  julafton: { sv: 'Julafton', en: 'Christmas Eve' },
  juldagen: { sv: 'Juldagen', en: 'Christmas Day' },
  'annandag-jul': { sv: 'Annandag jul', en: 'Boxing Day' },
  nyarsafton: { sv: 'Nyårsafton', en: "New Year's Eve" },
};

// All arithmetic is on UTC epoch milliseconds so DST and the host time zone never matter.
const DAY_MS = 86_400_000;

function utc(year: number, month: number, day: number): number {
  return Date.UTC(year, month - 1, day);
}

function fmt(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Easter Sunday (Gregorian), Meeus/Jones/Butcher algorithm. */
function easterSunday(year: number): number {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return utc(year, month, day);
}

/** First date on or after `start` that falls on `weekday` (0 = Sunday ... 6 = Saturday). */
function firstWeekdayOnOrAfter(start: number, weekday: number): number {
  const diff = (weekday - new Date(start).getUTCDay() + 7) % 7;
  return start + diff * DAY_MS;
}

/**
 * Swedish public holidays plus commonly observed eves for `year`, sorted by date.
 * Midsummer Day is the Saturday 20-26 June, All Saints' Day the Saturday 31 Oct-6 Nov.
 */
export function swedishHolidays(year: number): SwedishHoliday[] {
  if (!Number.isInteger(year) || year < 1583 || year > 9999) {
    throw new RangeError('year must be an integer between 1583 and 9999');
  }
  const easter = easterSunday(year);
  const midsommardagen = firstWeekdayOnOrAfter(utc(year, 6, 20), 6);

  const dates: Record<HolidayId, number> = {
    nyarsdagen: utc(year, 1, 1),
    'trettondedag-jul': utc(year, 1, 6),
    langfredag: easter - 2 * DAY_MS,
    paskafton: easter - DAY_MS,
    paskdagen: easter,
    'annandag-pask': easter + DAY_MS,
    '1-maj': utc(year, 5, 1),
    'kristi-himmelsfard': easter + 39 * DAY_MS,
    pingstdagen: easter + 49 * DAY_MS,
    nationaldagen: utc(year, 6, 6),
    midsommarafton: midsommardagen - DAY_MS,
    midsommardagen,
    'alla-helgons-dag': firstWeekdayOnOrAfter(utc(year, 10, 31), 6),
    julafton: utc(year, 12, 24),
    juldagen: utc(year, 12, 25),
    'annandag-jul': utc(year, 12, 26),
    nyarsafton: utc(year, 12, 31),
  };

  return HOLIDAY_IDS.map((id) => ({ id, date: fmt(dates[id]), name: { ...NAMES[id] } })).sort(
    (x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0),
  );
}
