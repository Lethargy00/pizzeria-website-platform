import { z } from 'zod';

/** Maximum length of a tenant slug (also used as the folder name under `tenants/`). */
export const MAX_SLUG_LENGTH = 64;

/**
 * A URL- and folder-safe identifier: lowercase ASCII letters and digits in groups separated by
 * single hyphens, e.g. `pizzeria-roma`, `home`, `lunch-2026`. No leading, trailing or double
 * hyphens, no dots, no slashes, so a slug can never form a path.
 */
export const Slug = z
  .string()
  .min(1)
  .max(MAX_SLUG_LENGTH)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export type Slug = z.infer<typeof Slug>;

/**
 * A time of day on a 24-hour clock, `HH:MM`, from `00:00` to `23:59`. `24:00` is not accepted;
 * the hours schema expresses "until midnight" and overnight hours itself.
 */
export const TimeOfDay = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export type TimeOfDay = z.infer<typeof TimeOfDay>;

/**
 * A calendar date, `YYYY-MM-DD`, that exists (leap years are checked). Kept as a string: it is a
 * date in `Europe/Stockholm`, not an instant, and `@pwp/core` interprets it.
 */
export const IsoDate = z.iso.date();
export type IsoDate = z.infer<typeof IsoDate>;
