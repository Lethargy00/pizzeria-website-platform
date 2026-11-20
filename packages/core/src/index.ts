/** @pwp/core: Pure, framework-free logic: opening hours and 'open now', time zones, allergen mapping, i18n helpers, slugs. */
export const PACKAGE_NAME = '@pwp/core' as const;

export { HOLIDAY_IDS, swedishHolidays } from './holidays/index.js';
export type { HolidayId, SwedishHoliday } from './holidays/index.js';
