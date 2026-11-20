/**
 * `@pwp/schema/hours`: the `hours.yaml` contract (#26). Weekly schedule, holiday rules and dated
 * exceptions per location, in `Europe/Stockholm` (DECISIONS #30).
 *
 * `hoursSchema(ctx)` is a factory of the tenant's `LocaleContext` (ADR 0003), because notes are
 * shown to visitors. The "open now" calculation is not here: it lives in `@pwp/core` (#30), which
 * reads intervals with {@link intervalSpan}.
 */
export {
  HOURS_TIME_ZONE,
  WEEKDAYS,
  HOLIDAY_IDS,
  HolidayId,
  MAX_INTERVALS_PER_DAY,
  MAX_HOURS_LOCATIONS,
  MAX_EXCEPTIONS,
  MAX_EXCEPTION_DAYS,
  intervalSpan,
  TimeInterval,
  DayIntervals,
  WeeklySchedule,
  holidayRuleSchema,
  hoursExceptionSchema,
  locationHoursSchema,
  hoursSchema,
  type Weekday,
  type Hours,
  type LocationHours,
  type HolidayRule,
  type HoursException,
} from './hours.js';
