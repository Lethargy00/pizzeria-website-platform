import { z } from 'zod';

/**
 * The days of the week, in ISO order (Monday first), as lowercase English day names. These are
 * the keys of a weekly schedule in `hours.yaml` (#26) and the values of `weekdays` lists in
 * `menu.yaml` (#25). The days are local days in `Europe/Stockholm`.
 *
 * `WEEKDAYS[(jsDay + 6) % 7]` maps a JavaScript `getDay()` value (0 = Sunday) to its id.
 * The order and the spelling are part of the contract (#144).
 */
export const WEEKDAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;
export const Weekday = z.enum(WEEKDAYS);
export type Weekday = z.infer<typeof Weekday>;
