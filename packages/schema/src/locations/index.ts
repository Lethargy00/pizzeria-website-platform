/**
 * `@pwp/schema/locations`: the contract for a tenant's `content/locations.yaml` (#27).
 *
 * Validate with `locationsSchema(ctx)`, where `ctx` comes from `parseSiteConfig` (ADR 0003).
 * Other files refer to a location by its {@link LocationId}; this module imports no other
 * domain schema.
 */
export {
  MAX_LOCATIONS,
  MAX_PLACE_TEXT_LENGTH,
  MAP_MODES,
  LocationId,
  PostalCode,
  Address,
  GeoPoint,
  HttpsUrl,
  locationSchema,
  locationsSchema,
  type MapMode,
  type Location,
  type LocationMap,
  type Locations,
} from './locations.js';
