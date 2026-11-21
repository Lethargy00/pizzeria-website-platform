import type { LocaleCode } from '@pwp/schema/primitives';
import { hreflang } from './localize.js';

/** All restaurants are in Sweden; times and dates are shown in this zone by default. */
export const DISPLAY_TIME_ZONE = 'Europe/Stockholm';

const numberFormats = new Map<string, Intl.NumberFormat>();
const dateFormats = new Map<string, Intl.DateTimeFormat>();

function numberFormat(locale: LocaleCode, whole: boolean): Intl.NumberFormat {
  const key = `${locale}:${whole}`;
  let f = numberFormats.get(key);
  if (!f) {
    const digits = whole ? 0 : 2;
    f = new Intl.NumberFormat(hreflang(locale), {
      style: 'currency',
      currency: 'SEK',
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    numberFormats.set(key, f);
  }
  return f;
}

function dateFormat(locale: LocaleCode, kind: 'time' | 'date', timeZone: string) {
  const key = `${locale}:${kind}:${timeZone}`;
  let f = dateFormats.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(
      hreflang(locale),
      kind === 'time'
        ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }
        : { dateStyle: 'medium', timeZone },
    );
    dateFormats.set(key, f);
  }
  return f;
}

/**
 * Formats a price for display. `ore` is an integer number of öre, the parsed output of
 * `PriceSEK` (`@pwp/schema/primitives`): `12900` is 129 kronor.
 *
 * `sv`: `129 kr`, `129,50 kr`, `12 900 kr` (non-breaking spaces, decimal comma).
 * `en`: `SEK 129`, `SEK 129.50`, `SEK 12,900`.
 * Whole kronor show no decimals; anything else shows two. Display only: no VAT, no totals.
 */
export function formatPrice(ore: number, locale: LocaleCode): string {
  if (!Number.isSafeInteger(ore)) throw new RangeError('A price must be an integer number of öre.');
  return numberFormat(locale, ore % 100 === 0).format(ore / 100);
}

function toDate(value: Date | number): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new RangeError('Invalid date.');
  return date;
}

/** Formats the time of day of an instant on a 24-hour clock, by default in Stockholm: `18:30`. */
export function formatTime(
  value: Date | number,
  locale: LocaleCode,
  timeZone: string = DISPLAY_TIME_ZONE,
): string {
  return dateFormat(locale, 'time', timeZone).format(toDate(value));
}

/**
 * Formats a range of dates, by default in Stockholm, collapsing shared parts:
 * `sv` `21–24 nov. 2026`, `en` `Nov 21 – 24, 2026`. Both ends on one day give one date.
 * Throws if `end` is before `start`.
 */
export function formatDateRange(
  start: Date | number,
  end: Date | number,
  locale: LocaleCode,
  timeZone: string = DISPLAY_TIME_ZONE,
): string {
  const from = toDate(start);
  const to = toDate(end);
  if (to < from) throw new RangeError('The end of a range cannot be before its start.');
  return dateFormat(locale, 'date', timeZone).formatRange(from, to);
}
