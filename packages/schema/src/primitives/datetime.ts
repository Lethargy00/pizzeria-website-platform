import { z } from 'zod';

/**
 * Zod's calendar-date pattern (`z.regexes.date`, the one behind `IsoDate`) without its
 * anchors, so the date half of a date-time gets the same month-length and leap-year rules.
 */
const DATE_SOURCE = z.regexes.date.source.slice(1, -1);

/**
 * `YYYY-MM-DDTHH:mm:ssZ` or `YYYY-MM-DDTHH:mm:ss.sssZ`, nothing else. One pattern inside one format
 * check, so a bad value raises exactly one `invalid_format` issue (`format: 'datetime'`), never a
 * second length or custom issue.
 */
const ISO_DATE_TIME_PATTERN = new RegExp(
  `^${DATE_SOURCE}T(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d{3})?Z$`,
);

/** Length of the longest accepted value, `2026-11-21T04:00:00.000Z`. The pattern bounds it. */
export const MAX_ISO_DATE_TIME_LENGTH = 24;

/**
 * An instant in UTC as an ISO 8601 / RFC 3339 string (#145), e.g. `2026-11-21T04:00:00Z` or
 * `2026-11-21T04:00:00.000Z` (what `Date.prototype.toISOString()` returns).
 *
 * What is accepted, exactly:
 * - A four-digit year, `-`, month, `-`, day, an upper-case `T`, `HH:mm:ss`, an upper-case `Z`.
 * - Optionally a fraction of **exactly three digits** (milliseconds) after the seconds. One, two
 *   or more than three digits are rejected: a JavaScript `Date` holds milliseconds, so finer
 *   digits would be dropped silently, and a single spelling per instant keeps logs and tests
 *   comparable. This also bounds the length ({@link MAX_ISO_DATE_TIME_LENGTH}).
 * - A date that exists: month lengths and leap years are checked (`2028-02-29` yes,
 *   `2026-02-29` and `2026-02-30` no), as in `IsoDate`.
 * - Hours `00` to `23`, minutes and seconds `00` to `59`.
 *
 * Rejected: any offset (`+01:00`, also `+00:00`, `-00:00`), local time without `Z`, a lower-case
 * `t` or `z`, a space instead of `T`, a missing seconds part, `24:00:00`, leap second `:60`,
 * expanded years (`+002026`), a date only, and surrounding whitespace. Leap seconds are rejected
 * because a JavaScript `Date` cannot represent them.
 *
 * Kept as a string, like `IsoDate`; consumers parse it with `new Date(value)`.
 */
export const IsoDateTime = z.stringFormat('datetime', ISO_DATE_TIME_PATTERN);
export type IsoDateTime = z.infer<typeof IsoDateTime>;
