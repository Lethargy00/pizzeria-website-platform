import { z } from 'zod';

/** The highest price a tenant may enter, in kronor. Guards against typos like `1290000`. */
export const MAX_PRICE_SEK = 100_000;

/**
 * A consumer price in Swedish kronor, for display only (DECISIONS #4, #56: the price as entered,
 * VAT included, no VAT computation, no totals).
 *
 * **Input** (what the tenant writes): a number of kronor, `0` to {@link MAX_PRICE_SEK}, with at
 * most two decimals, e.g. `129`, `129.5` or `129.95`. Strings (`"129 kr"`, `"129,50"`) are
 * rejected.
 * **Output** (what code receives): an integer number of **öre**, e.g. `12995`, so nothing
 * downstream works with binary fractions. `@pwp/core` formats it for display.
 */
export const PriceSEK = z
  .number()
  .min(0)
  .max(MAX_PRICE_SEK)
  .multipleOf(0.01)
  .transform((kronor) => Math.round(kronor * 100));
/** A price in öre (the parsed output of {@link PriceSEK}). */
export type PriceSEK = z.output<typeof PriceSEK>;
