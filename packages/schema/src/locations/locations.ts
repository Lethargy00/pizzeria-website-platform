import { z } from 'zod';
import {
  Email,
  ImageRef,
  PhoneNumber,
  Slug,
  isSafeUrl,
  localizedStringFor,
  singleLineText,
  strictObject,
  type LocaleContext,
} from '../primitives/index.js';

/** Most locations one tenant may list in `locations.yaml`. */
export const MAX_LOCATIONS = 50;

/** Maximum length of a location name, a street or a city. */
export const MAX_PLACE_TEXT_LENGTH = 200;

/**
 * The id of a location, e.g. `sodermalm`. A {@link Slug}: other files (hours #26, menu price
 * overrides) refer to a location by this id, and it can appear in a URL.
 */
export const LocationId = Slug;
export type LocationId = z.infer<typeof LocationId>;

/**
 * A Swedish postal code written the standard way, three digits, a space, two digits:
 * `118 46`. `11846`, `118-46` and `SE-118 46` are rejected so every site prints the same form.
 */
export const PostalCode = z.string().regex(/^\d{3} \d{2}$/);
export type PostalCode = z.infer<typeof PostalCode>;

/**
 * A proper name or address line: one line of visitor-facing text (`singleLineText`). Names of
 * places and streets are not translated, so they are plain text, not a localized string.
 */
const PlaceText = singleLineText(MAX_PLACE_TEXT_LENGTH);

/** A postal address in Sweden. */
export const Address = strictObject({
  street: PlaceText,
  postalCode: PostalCode,
  city: PlaceText,
});
export type Address = z.infer<typeof Address>;

/** A point on the map in WGS 84 decimal degrees, e.g. `{ lat: 59.3157, lng: 18.0727 }`. */
export const GeoPoint = strictObject({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type GeoPoint = z.infer<typeof GeoPoint>;

/**
 * How a location's map is shown (DECISIONS #31). Nothing third-party loads before consent:
 * - `none`: no map.
 * - `static-image`: a map image from the tenant's own `assets/`.
 * - `click-to-load`: a placeholder; the map adapter loads only after the visitor clicks. Needs
 *   `geo` on the location.
 */
export const MAP_MODES = ['none', 'static-image', 'click-to-load'] as const;
export type MapMode = (typeof MAP_MODES)[number];

/**
 * An outbound `https://` link (order platform, booking system): a link that passes
 * {@link isSafeUrl} and starts with `https://`. Both are checked in one refinement, so a bad link
 * raises exactly one `unsafe_url` issue that names only `https:`. `mailto:` and `tel:` are not
 * order or booking pages, and click-to-call uses `phone`. Rendered only as a link, never embedded.
 */
export const HttpsUrl = z
  .string()
  .refine((value) => value.startsWith('https://') && isSafeUrl(value), {
    error: 'Only https: links are allowed here.',
    params: { pwpCode: 'unsafe_url', allowedSchemes: ['https:'] },
  });
export type HttpsUrl = z.infer<typeof HttpsUrl>;

function mapSchema(ctx: LocaleContext) {
  return z
    .discriminatedUnion('mode', [
      strictObject({ mode: z.literal('none') }),
      strictObject({
        mode: z.literal('static-image'),
        image: ImageRef,
        /** Describes what the map shows, for screen readers. */
        alt: localizedStringFor(ctx.locales),
      }),
      strictObject({ mode: z.literal('click-to-load') }),
    ])
    .default({ mode: 'none' });
}

/** One location of a tenant: one restaurant with its own address and contact details. */
export function locationSchema(ctx: LocaleContext) {
  return strictObject({
    id: LocationId,
    /** The location's name as shown to visitors, e.g. `Pizzeria Roma Södermalm`. */
    name: PlaceText,
    address: Address,
    /** For click-to-call (DECISIONS #32). */
    phone: PhoneNumber,
    email: Email.optional(),
    geo: GeoPoint.optional(),
    /** Defaults to `{ mode: none }`. */
    map: mapSchema(ctx),
    /** Order via an external platform or the pizzeria's own system (DECISIONS #32). */
    orderUrl: HttpsUrl.optional(),
    /** An external table booking page (DECISIONS #35). */
    bookingUrl: HttpsUrl.optional(),
    /** Where the location delivers, as free text (DECISIONS #34). No zones in v1. */
    deliveryArea: localizedStringFor(ctx.locales).optional(),
  }).superRefine((location, issues) => {
    // Fires only when `geo` is absent, which no primitive rejects; a present but invalid `geo`
    // gets only `GeoPoint`'s own issue.
    if (location.map.mode === 'click-to-load' && location.geo === undefined) {
      issues.addIssue({
        code: 'custom',
        path: ['geo'],
        message: 'A click-to-load map needs `geo` with `lat` and `lng`.',
      });
    }
  });
}

/**
 * The whole `content/locations.yaml` file of a tenant: 1 to {@link MAX_LOCATIONS} locations
 * (DECISIONS #7) with unique ids. A repeated id is reported at the later entry's `id`.
 *
 * Built for the tenant's {@link LocaleContext} (ADR 0003); the loader passes the context from
 * `parseSiteConfig`.
 */
export function locationsSchema(ctx: LocaleContext) {
  return strictObject({
    locations: z.array(locationSchema(ctx)).min(1).max(MAX_LOCATIONS),
  }).superRefine((file, issues) => {
    const seen = new Set<string>();
    file.locations.forEach((location, index) => {
      // A format failure inside an entry does not stop this check (zod 4), so skip ids that
      // `LocationId` already rejected: they get their own issue, never a second one here.
      if (!LocationId.safeParse(location.id).success) return;
      if (seen.has(location.id)) {
        issues.addIssue({
          code: 'custom',
          path: ['locations', index, 'id'],
          message: `The location id \`${location.id}\` is used more than once.`,
        });
      }
      seen.add(location.id);
    });
  });
}

export type Locations = z.output<ReturnType<typeof locationsSchema>>;
export type Location = z.output<ReturnType<typeof locationSchema>>;
export type LocationMap = Location['map'];
