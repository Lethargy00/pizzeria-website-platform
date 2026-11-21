import { z } from 'zod';
import {
  ImageRef,
  IsoDate,
  PriceSEK,
  Slug,
  TimeOfDay,
  WEEKDAYS,
  Weekday,
  localizedStringFor,
  strictObject,
  type LocaleContext,
} from '../primitives/index.js';

/**
 * The 14 allergens of EU regulation 1169/2011, Annex II (DECISIONS #55), in Annex II order.
 * These ids are stable: `@pwp/core` (#32) maps each one to sv/en labels and an icon id.
 *
 * `gluten` is "cereals containing gluten", `nuts` is "tree nuts" (peanuts are separate),
 * `sulphites` is "sulphur dioxide and sulphites".
 */
export const ALLERGENS = [
  'gluten',
  'crustaceans',
  'eggs',
  'fish',
  'peanuts',
  'soy',
  'milk',
  'nuts',
  'celery',
  'mustard',
  'sesame',
  'sulphites',
  'lupin',
  'molluscs',
] as const;
export const Allergen = z.enum(ALLERGENS);
export type Allergen = z.infer<typeof Allergen>;

/**
 * Dietary tags an item may carry. Spiciness is not a tag: it is the separate `spicy` level, so a
 * dish cannot be "spicy" and "extra spicy" at once.
 */
export const DIETARY_TAGS = ['vegan', 'vegetarian', 'gluten-free', 'lactose-free'] as const;
export const DietaryTag = z.enum(DIETARY_TAGS);
export type DietaryTag = z.infer<typeof DietaryTag>;

/** Spiciness from 1 (mild) to {@link MAX_SPICY_LEVEL} (hot). Leave `spicy` out for none. */
export const MAX_SPICY_LEVEL = 3;
export const SpicyLevel = z.int().min(1).max(MAX_SPICY_LEVEL);
export type SpicyLevel = z.infer<typeof SpicyLevel>;

/** Limits that guard against runaway files. */
export const MENU_LIMITS = {
  categories: 50,
  itemsPerCategory: 200,
  sizes: 10,
  extras: 50,
  lunchItems: 50,
  specials: 100,
  specialDates: 366,
  overrideLocations: 50,
  overrideItems: 500,
} as const;

/** The id of a category, item, size or extra: a {@link Slug}, e.g. `margherita`, `family`. */
export const MenuId = Slug;
export type MenuId = z.infer<typeof MenuId>;

/**
 * True if `value` passes `schema`. Zod 4 runs refinements even when a field inside already
 * failed, so every cross-field check first skips values a primitive rejected. The tenant then
 * sees exactly one issue per mistake.
 */
function passes(schema: z.ZodType, value: unknown): boolean {
  return schema.safeParse(value).success;
}

/**
 * A list of enum values without repeats. A repeat is an issue at its index, so the tenant sees
 * which entry to remove.
 */
function uniqueList<T extends string>(item: z.ZodType<T>, max: number, noun: string) {
  return z
    .array(item)
    .max(max)
    .superRefine((list, ctx) => {
      const seen = new Set<unknown>();
      list.forEach((value, index) => {
        if (!passes(item, value)) return;
        if (seen.has(value)) {
          ctx.addIssue({
            code: 'custom',
            path: [index],
            message: `The ${noun} \`${String(value)}\` is listed more than once.`,
          });
        }
        seen.add(value);
      });
    });
}

/**
 * Adds an issue at `[...path, index, 'id']` for every entry whose id was seen before. Ids that
 * are not a valid {@link MenuId} already have their own issue and are skipped.
 */
function checkUniqueIds(
  entries: readonly { readonly id: string }[],
  path: readonly (string | number)[],
  noun: string,
  ctx: z.RefinementCtx,
  seen: Set<string> = new Set(),
): void {
  entries.forEach((entry, index) => {
    if (!passes(MenuId, entry.id)) return;
    if (seen.has(entry.id)) {
      ctx.addIssue({
        code: 'custom',
        path: [...path, index, 'id'],
        message: `The ${noun} id \`${entry.id}\` is used more than once.`,
      });
    }
    seen.add(entry.id);
  });
}

/** One size of an item, with its own price, e.g. `{ id: family, name: { sv: Familj }, price: 249 }`. */
function sizeSchema(ctx: LocaleContext) {
  return strictObject({
    id: MenuId,
    name: localizedStringFor(ctx.locales),
    price: PriceSEK,
  });
}

/** An extra or topping that can be added to an item, at a price (`0` for free). */
function extraSchema(ctx: LocaleContext) {
  return strictObject({
    id: MenuId,
    name: localizedStringFor(ctx.locales),
    price: PriceSEK,
    allergens: uniqueList(Allergen, ALLERGENS.length, 'allergen').optional(),
  });
}

/**
 * The fields of every dish: in a category, on the lunch menu, or as a daily special.
 *
 * - Exactly one of `price` (one price) or `sizes` (one price per size) is given.
 * - `name` and `description` are **plain text**, never Markdown or HTML. Renderers escape them.
 * - `allergens` lists the EU-14 allergens the dish contains. Leaving it out means "not stated",
 *   not "none": the allergen legend and info page (#32) say so.
 * - `soldOut: true` keeps the dish on the menu, marked as sold out.
 */
function itemShape(ctx: LocaleContext) {
  return {
    id: MenuId,
    name: localizedStringFor(ctx.locales),
    description: localizedStringFor(ctx.locales).optional(),
    image: ImageRef.optional(),
    /** Alt text for `image`. Required when `image` is given. */
    imageAlt: localizedStringFor(ctx.locales).optional(),
    price: PriceSEK.optional(),
    sizes: z.array(sizeSchema(ctx)).min(1).max(MENU_LIMITS.sizes).optional(),
    extras: z.array(extraSchema(ctx)).max(MENU_LIMITS.extras).optional(),
    allergens: uniqueList(Allergen, ALLERGENS.length, 'allergen').optional(),
    dietary: uniqueList(DietaryTag, DIETARY_TAGS.length, 'dietary tag').optional(),
    spicy: SpicyLevel.optional(),
    soldOut: z.boolean().default(false),
  };
}

interface ItemLike {
  readonly price?: number | undefined;
  readonly sizes?: readonly { readonly id: string }[] | undefined;
  readonly extras?: readonly { readonly id: string }[] | undefined;
  readonly image?: string | undefined;
  readonly imageAlt?: unknown;
}

function checkItem(item: ItemLike, ctx: z.RefinementCtx): void {
  const hasPrice = item.price !== undefined;
  const hasSizes = item.sizes !== undefined;
  if (hasPrice === hasSizes) {
    ctx.addIssue({
      code: 'custom',
      path: hasPrice ? ['sizes'] : ['price'],
      message: hasPrice
        ? 'Give either `price` or `sizes`, not both.'
        : 'Give the dish a `price`, or `sizes` with a price for each size.',
    });
  }
  if (item.sizes) checkUniqueIds(item.sizes, ['sizes'], 'size', ctx);
  if (item.extras) checkUniqueIds(item.extras, ['extras'], 'extra', ctx);
  if (item.image !== undefined && item.imageAlt === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['imageAlt'],
      message: 'An item with an `image` needs `imageAlt` describing the image.',
    });
  }
}

/** One dish on the menu. See {@link itemShape} for the rules. */
export function menuItemSchema(ctx: LocaleContext) {
  return strictObject(itemShape(ctx)).superRefine(checkItem);
}

/** A menu category, e.g. "Pizzor", with its dishes in display order. */
export function menuCategorySchema(ctx: LocaleContext) {
  return strictObject({
    id: MenuId,
    name: localizedStringFor(ctx.locales),
    description: localizedStringFor(ctx.locales).optional(),
    items: z.array(menuItemSchema(ctx)).min(1).max(MENU_LIMITS.itemsPerCategory),
  });
}

/**
 * The lunch menu: its own dishes, served on `weekdays` from `start` to `end` (local time,
 * `start` before `end`, both `HH:MM`). `@pwp/core` (#33) answers "is lunch on now".
 */
export function lunchSchema(ctx: LocaleContext) {
  return strictObject({
    title: localizedStringFor(ctx.locales).optional(),
    description: localizedStringFor(ctx.locales).optional(),
    weekdays: uniqueList(Weekday, WEEKDAYS.length, 'weekday').min(1),
    start: TimeOfDay,
    end: TimeOfDay,
    items: z.array(menuItemSchema(ctx)).min(1).max(MENU_LIMITS.lunchItems),
  }).superRefine((lunch, issues) => {
    if (
      passes(TimeOfDay, lunch.start) &&
      passes(TimeOfDay, lunch.end) &&
      lunch.start >= lunch.end
    ) {
      issues.addIssue({
        code: 'custom',
        path: ['end'],
        message: `Lunch must end after it starts (${lunch.start}).`,
      });
    }
  });
}

/**
 * A daily special: a dish shown on given `dates` (e.g. `2026-12-24`) or on given `weekdays`
 * (e.g. every Friday). Exactly one of the two is given.
 */
export function specialSchema(ctx: LocaleContext) {
  return strictObject({
    ...itemShape(ctx),
    dates: uniqueList(IsoDate, MENU_LIMITS.specialDates, 'date').min(1).optional(),
    weekdays: uniqueList(Weekday, WEEKDAYS.length, 'weekday').min(1).optional(),
  }).superRefine((special, issues) => {
    checkItem(special, issues);
    if ((special.dates === undefined) === (special.weekdays === undefined)) {
      issues.addIssue({
        code: 'custom',
        path: special.dates === undefined ? ['dates'] : ['weekdays'],
        message:
          special.dates === undefined
            ? 'Give the special `dates` or `weekdays` it is served on.'
            : 'Give either `dates` or `weekdays`, not both.',
      });
    }
  });
}

/**
 * What changes for one item at one location. Context-free: an override holds no visitor text.
 *
 * - `price` replaces the price of an item that has one `price`.
 * - `sizes` replaces the prices of some sizes, keyed by size id: `{ family: 259 }`.
 * - `available: false` hides the item at this location.
 * - `soldOut` replaces the item's own `soldOut` at this location.
 */
export const ItemOverride = strictObject({
  price: PriceSEK.optional(),
  sizes: z.record(MenuId, PriceSEK).optional(),
  available: z.boolean().optional(),
  soldOut: z.boolean().optional(),
});
export type ItemOverride = z.output<typeof ItemOverride>;

/**
 * Overrides for one location, keyed by item id. The location itself is the key in
 * `overrides`, a `LocationId` (a {@link Slug}) from `locations.yaml`. Whether that id exists is
 * checked across files by {@link checkMenuLocations}.
 */
export const LocationOverride = strictObject({
  items: z.record(MenuId, ItemOverride),
});
export type LocationOverride = z.output<typeof LocationOverride>;

interface PricedItem {
  readonly id: string;
  readonly price?: number | undefined;
  readonly sizes?: readonly { readonly id: string }[] | undefined;
}

/**
 * The whole `content/menu.yaml` file of a tenant (DECISIONS #29, #55, #56).
 *
 * Built for the tenant's {@link LocaleContext} (ADR 0003); the loader passes the context from
 * `parseSiteConfig`. Checks across the file:
 * - Category ids are unique. Item ids are unique across categories, lunch and specials, so an
 *   override names exactly one dish.
 * - Every override names an existing item, prices only what that item has (`price` for a
 *   single-price item, `sizes` keys that are its size ids).
 * Location ids in `overrides` are checked against `locations.yaml` by {@link checkMenuLocations}.
 *
 * **Prices.** Written in kronor (`129`, `129.50`), VAT included, as the tenant wants them shown.
 * The parsed output is an integer number of **öre** (`12900`); `@pwp/core` formats it (#31).
 */
export function menuSchema(ctx: LocaleContext) {
  return strictObject({
    categories: z.array(menuCategorySchema(ctx)).min(1).max(MENU_LIMITS.categories),
    lunch: lunchSchema(ctx).optional(),
    specials: z.array(specialSchema(ctx)).max(MENU_LIMITS.specials).optional(),
    overrides: z.record(Slug, LocationOverride).optional(),
  }).superRefine((menu, issues) => {
    checkUniqueIds(menu.categories, ['categories'], 'category', issues);

    const items = new Map<string, PricedItem>();
    const seen = new Set<string>();
    menu.categories.forEach((category, index) => {
      checkUniqueIds(category.items, ['categories', index, 'items'], 'item', issues, seen);
      for (const item of category.items) if (!items.has(item.id)) items.set(item.id, item);
    });
    if (menu.lunch) {
      checkUniqueIds(menu.lunch.items, ['lunch', 'items'], 'item', issues, seen);
      for (const item of menu.lunch.items) if (!items.has(item.id)) items.set(item.id, item);
    }
    if (menu.specials) {
      checkUniqueIds(menu.specials, ['specials'], 'item', issues, seen);
      for (const item of menu.specials) if (!items.has(item.id)) items.set(item.id, item);
    }

    const overrides = Object.entries(menu.overrides ?? {});
    if (overrides.length > MENU_LIMITS.overrideLocations) {
      issues.addIssue({
        code: 'custom',
        path: ['overrides'],
        message: `Overrides may name at most ${MENU_LIMITS.overrideLocations} locations.`,
      });
    }
    for (const [locationId, override] of overrides) {
      const entries = Object.entries(override.items);
      if (entries.length > MENU_LIMITS.overrideItems) {
        issues.addIssue({
          code: 'custom',
          path: ['overrides', locationId, 'items'],
          message: `One location may override at most ${MENU_LIMITS.overrideItems} items.`,
        });
      }
      for (const [itemId, change] of entries) {
        // A key that is not a MenuId already has an `invalid_key` issue from the record.
        if (!passes(MenuId, itemId)) continue;
        const path = ['overrides', locationId, 'items', itemId];
        const item = items.get(itemId);
        if (!item) {
          issues.addIssue({
            code: 'custom',
            path,
            message: `There is no item with the id \`${itemId}\` on this menu.`,
          });
          continue;
        }
        if (change.price !== undefined && item.price === undefined) {
          issues.addIssue({
            code: 'custom',
            path: [...path, 'price'],
            message: `The item \`${itemId}\` has sizes; override the size prices under \`sizes\`.`,
          });
        }
        if (change.sizes !== undefined) {
          const sizeIds = new Set((item.sizes ?? []).map((size) => size.id));
          for (const sizeId of Object.keys(change.sizes)) {
            if (passes(MenuId, sizeId) && !sizeIds.has(sizeId)) {
              issues.addIssue({
                code: 'custom',
                path: [...path, 'sizes', sizeId],
                message: `The item \`${itemId}\` has no size with the id \`${sizeId}\`.`,
              });
            }
          }
        }
      }
    }
  });
}

/** A validated menu (output form: prices in öre, `soldOut` filled in). */
export type Menu = z.output<ReturnType<typeof menuSchema>>;
export type MenuCategory = Menu['categories'][number];
export type MenuItem = MenuCategory['items'][number];
export type MenuSize = NonNullable<MenuItem['sizes']>[number];
export type MenuExtra = NonNullable<MenuItem['extras']>[number];
export type Lunch = NonNullable<Menu['lunch']>;
export type Special = NonNullable<Menu['specials']>[number];

/**
 * Cross-file check: every location id used as a key in `menu.overrides` must be a location in
 * `locations.yaml`. Call it after both files validated. Returns Zod `custom` issues with paths
 * relative to the menu file root (`['overrides', '<id>']`), empty when all ids are known, so the
 * loader can report them with `new z.ZodError(issues)` like any other menu issue.
 */
export function checkMenuLocations(
  menu: Pick<Menu, 'overrides'>,
  locationIds: Iterable<string>,
): z.core.$ZodIssueCustom[] {
  const known = new Set(locationIds);
  return Object.keys(menu.overrides ?? {})
    .filter((id) => !known.has(id))
    .map((id) => ({
      code: 'custom',
      path: ['overrides', id],
      input: id,
      message: `There is no location with the id \`${id}\` in locations.yaml.`,
    }));
}
