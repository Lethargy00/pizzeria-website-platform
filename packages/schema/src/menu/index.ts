/**
 * `@pwp/schema/menu`: the contract for a tenant's `content/menu.yaml` (#25).
 *
 * Validate with `menuSchema(ctx)`, where `ctx` comes from `parseSiteConfig` (ADR 0003). Once
 * `locations.yaml` has validated too, run `checkMenuLocations(menu, locationIds)` for the
 * location ids used in `overrides`. Prices are written in kronor and parsed to integer öre
 * (`PriceSEK`). Names and descriptions are plain text, never Markdown. This module imports no
 * other domain schema.
 */
export {
  ALLERGENS,
  Allergen,
  DIETARY_TAGS,
  DietaryTag,
  MAX_SPICY_LEVEL,
  SpicyLevel,
  WEEKDAYS,
  Weekday,
  MENU_LIMITS,
  MenuId,
  ItemOverride,
  LocationOverride,
  menuItemSchema,
  menuCategorySchema,
  lunchSchema,
  specialSchema,
  menuSchema,
  checkMenuLocations,
  type Menu,
  type MenuCategory,
  type MenuItem,
  type MenuSize,
  type MenuExtra,
  type Lunch,
  type Special,
} from './menu.js';
