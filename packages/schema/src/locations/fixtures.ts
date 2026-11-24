/**
 * Valid and invalid fixtures for `@pwp/schema/locations` (#27), in input form (ADR 0003 §5).
 * Used by `locations.test.ts`. Not exported from `@pwp/schema/locations`.
 *
 * All places, numbers and addresses are fictional.
 */
import { SINGLE_LINE_TEXT_UNSAFE, type Fixtures } from '../primitives/fixtures.js';

const NOT_OBJECTS = [undefined, null, 1, 'x', true, []] as const;

/** A complete location for a tenant with `locales: ['sv', 'en']`. */
export const fullLocation = {
  id: 'sodermalm',
  name: 'Pizzeria Exempel Södermalm',
  address: { street: 'Exempelgatan 12', postalCode: '118 46', city: 'Stockholm' },
  phone: '+46812345678',
  email: 'sodermalm@pizzeria-exempel.se',
  geo: { lat: 59.3157, lng: 18.0727 },
  map: { mode: 'click-to-load' },
  orderUrl: 'https://order.example.com/pizzeria-exempel',
  bookingUrl: 'https://booking.example.com/exempel?location=sodermalm',
  deliveryArea: { sv: 'Södermalm och Gamla stan', en: 'Södermalm and the Old Town' },
} as const;

/** The smallest valid location. */
export const minimalLocation = {
  id: 'centrum',
  name: 'Pizzeria Exempel',
  address: { street: 'Storgatan 1', postalCode: '411 01', city: 'Göteborg' },
  phone: '+46311234567',
} as const;

/** A copy of `value` without `key`. */
export function omit(
  value: Readonly<Record<string, unknown>>,
  key: string,
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([k]) => k !== key));
}

function withLocation(patch: Record<string, unknown>): unknown {
  return { locations: [{ ...fullLocation, ...patch }] };
}

function withAddress(patch: Record<string, unknown>): unknown {
  return withLocation({ address: { ...fullLocation.address, ...patch } });
}

/** For `locationsSchema({ locales: ['sv', 'en'] })`. */
export const locationsSvEnFixtures: Fixtures = {
  valid: [
    { locations: [minimalLocation] },
    { locations: [fullLocation] },
    { locations: [fullLocation, minimalLocation] },
    withLocation({ map: { mode: 'none' } }),
    withLocation({
      map: {
        mode: 'static-image',
        image: 'assets/map-sodermalm.png',
        alt: { sv: 'Karta över Södermalm', en: 'Map of Södermalm' },
      },
      geo: undefined,
    }),
    withLocation({ geo: { lat: -90, lng: 180 } }),
    withLocation({ geo: { lat: 0, lng: -180 } }),
    withAddress({ postalCode: '000 00' }),
    withLocation({ name: '  Pizzeria Exempel  ' }),
    withLocation({ name: 'Café Ängel & Söner 🍕' }),
    withAddress({ street: 'Rörstrandsgatan 4–6', city: 'Malmö' }),
    {
      locations: Array.from({ length: 50 }, (_, i) => ({ ...minimalLocation, id: `plats-${i}` })),
    },
  ],
  invalid: [
    ...NOT_OBJECTS,
    {},
    { locations: [] },
    { locations: minimalLocation },
    { locations: [minimalLocation], extra: true },
    {
      locations: Array.from({ length: 51 }, (_, i) => ({ ...minimalLocation, id: `plats-${i}` })),
    },
    // Unique ids
    { locations: [minimalLocation, minimalLocation] },
    { locations: [fullLocation, minimalLocation, { ...minimalLocation, id: 'sodermalm' }] },
    // Unknown keys at every level
    withLocation({ slug: 'x' }),
    withAddress({ country: 'SE' }),
    withLocation({ geo: { lat: 59, lng: 18, alt: 10 } }),
    withLocation({ map: { mode: 'click-to-load', zoom: 14 } }),
    withLocation({ deliveryArea: { sv: 'Söder', en: 'South', de: 'Süd' } }),
    // Required fields
    ...(['id', 'name', 'address', 'phone'] as const).map((key) => ({
      locations: [omit(minimalLocation, key)],
    })),
    ...(['street', 'postalCode', 'city'] as const).map((key) =>
      withLocation({ address: omit(fullLocation.address, key) }),
    ),
    // id
    withLocation({ id: 'Södermalm' }),
    withLocation({ id: 'soder malm' }),
    withLocation({ id: '../x' }),
    withLocation({ id: '' }),
    // Text
    withLocation({ name: '' }),
    withLocation({ name: '   ' }),
    withLocation({ name: 'Rad ett\nRad två' }),
    withLocation({ name: 'x'.repeat(201) }),
    withLocation({ name: { sv: 'Exempel' } }),
    withAddress({ street: '' }),
    withAddress({ city: 'x'.repeat(201) }),
    // #157: every character class `singleLineText` rejects, in name, street and city.
    ...SINGLE_LINE_TEXT_UNSAFE.flatMap(([, value]) => [
      withLocation({ name: value }),
      withAddress({ street: value }),
      withAddress({ city: value }),
    ]),
    // Swedish postal code
    withAddress({ postalCode: '11846' }),
    withAddress({ postalCode: '118-46' }),
    withAddress({ postalCode: 'SE-118 46' }),
    withAddress({ postalCode: '118  46' }),
    withAddress({ postalCode: ' 118 46' }),
    withAddress({ postalCode: '1184 6' }),
    withAddress({ postalCode: '118 4' }),
    withAddress({ postalCode: 'ABC DE' }),
    withAddress({ postalCode: 11846 }),
    // Contact
    withLocation({ phone: '08-123 456 78' }),
    withLocation({ phone: 'tel:+46812345678' }),
    withLocation({ email: 'not-an-email' }),
    withLocation({ email: 'a@b.se\nBcc: x@evil.example' }),
    // Geo
    withLocation({ geo: { lat: 91, lng: 18 } }),
    withLocation({ geo: { lat: 59, lng: -181 } }),
    withLocation({ geo: { lat: '59.3', lng: '18.0' } }),
    withLocation({ geo: { lat: Number.NaN, lng: 18 } }),
    withLocation({ geo: { lat: 59 } }),
    // Map
    withLocation({ map: 'click-to-load' }),
    withLocation({ map: { mode: 'embed' } }),
    withLocation({ map: { mode: 'iframe', src: 'https://maps.example.com/embed' } }),
    withLocation({ map: { mode: 'click-to-load' }, geo: undefined }),
    withLocation({ map: { mode: 'static-image', alt: { sv: 'Karta', en: 'Map' } } }),
    withLocation({ map: { mode: 'static-image', image: 'assets/map.png' } }),
    withLocation({
      map: { mode: 'static-image', image: 'assets/map.png', alt: { sv: 'Karta' } },
    }),
    withLocation({
      map: { mode: 'static-image', image: 'assets/map.svg', alt: { sv: 'Karta', en: 'Map' } },
    }),
    withLocation({
      map: {
        mode: 'static-image',
        image: 'https://maps.example.com/static.png',
        alt: { sv: 'Karta', en: 'Map' },
      },
    }),
    withLocation({
      map: { mode: 'static-image', image: '../x/map.png', alt: { sv: 'Karta', en: 'Map' } },
    }),
    // External links: SafeUrl, https only
    withLocation({ orderUrl: 'javascript:alert(1)' }),
    withLocation({ orderUrl: 'http://order.example.com' }),
    withLocation({ orderUrl: 'HTTPS://order.example.com' }),
    withLocation({ orderUrl: '//order.example.com' }),
    withLocation({ orderUrl: '/order' }),
    withLocation({ orderUrl: 'tel:+46812345678' }),
    withLocation({ orderUrl: 'mailto:order@pizzeria-exempel.se' }),
    withLocation({ orderUrl: 'https://user:pass@order.example.com' }),
    withLocation({ bookingUrl: 'data:text/html,<script>alert(1)</script>' }),
    withLocation({ bookingUrl: ' https://booking.example.com' }),
    withLocation({ bookingUrl: 'mailto:boka@pizzeria-exempel.se' }),
    // Delivery area
    withLocation({ deliveryArea: 'Södermalm' }),
    withLocation({ deliveryArea: { sv: 'Södermalm' } }),
    withLocation({ deliveryArea: { sv: 'Södermalm', en: '' } }),
  ],
};

/** For `locationsSchema({ locales: ['sv'] })`. */
export const locationsSvFixtures: Fixtures = {
  valid: [
    { locations: [minimalLocation] },
    { locations: [{ ...minimalLocation, deliveryArea: { sv: 'Hela Göteborg' } }] },
  ],
  invalid: [
    { locations: [{ ...minimalLocation, deliveryArea: { sv: 'Hela', en: 'All of it' } }] },
    { locations: [{ ...minimalLocation, deliveryArea: { en: 'All of Gothenburg' } }] },
  ],
};
