import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  GeoPoint,
  HttpsUrl,
  MAP_MODES,
  PostalCode,
  locationsSchema,
  type Location,
  type Locations,
} from './index.js';
import * as locations from './index.js';
import {
  fullLocation,
  locationsSvEnFixtures,
  locationsSvFixtures,
  minimalLocation,
  omit,
} from './fixtures.js';
import { SINGLE_LINE_TEXT_UNSAFE, safeUrlFixtures, type Fixtures } from '../primitives/fixtures.js';

const label = (value: unknown): string => String(JSON.stringify(value)).slice(0, 160);

function table(name: string, schema: z.ZodType, fixtures: Fixtures): void {
  describe(name, () => {
    it.each(fixtures.valid.map((v, i) => [i, label(v), v]))('accepts #%i %s', (_, __, value) => {
      expect(schema.safeParse(value).success).toBe(true);
    });
    it.each(fixtures.invalid.map((v, i) => [i, label(v), v]))('rejects #%i %s', (_, __, value) => {
      expect(schema.safeParse(value).success).toBe(false);
    });
  });
}

const SvEn = locationsSchema({ locales: ['sv', 'en'] });

table("locationsSchema(['sv', 'en'])", SvEn, locationsSvEnFixtures);
table("locationsSchema(['sv'])", locationsSchema({ locales: ['sv'] }), locationsSvFixtures);

function issues(value: unknown): { path: PropertyKey[]; code: string }[] {
  const result = SvEn.safeParse(value);
  return (result.error?.issues ?? []).map((issue) => ({ path: issue.path, code: issue.code }));
}

describe('locations module surface', () => {
  it('exports exactly the documented names', () => {
    expect(Object.keys(locations).sort()).toEqual(
      [
        'Address',
        'GeoPoint',
        'HttpsUrl',
        'LocationId',
        'MAP_MODES',
        'MAX_LOCATIONS',
        'MAX_PLACE_TEXT_LENGTH',
        'PostalCode',
        'locationSchema',
        'locationsSchema',
      ].sort(),
    );
  });

  it('lists the map modes of DECISIONS #31', () => {
    expect(MAP_MODES).toEqual(['none', 'static-image', 'click-to-load']);
  });

  it('is a pure factory: two contexts give independent schemas', () => {
    const sv = locationsSchema({ locales: ['sv'] });
    const value = { locations: [{ ...minimalLocation, deliveryArea: { sv: 'Söder' } }] };
    expect(sv.safeParse(value).success).toBe(true);
    expect(SvEn.safeParse(value).success).toBe(false);
    expect(locationsSchema({ locales: ['sv'] }).safeParse(value).success).toBe(true);
  });
});

describe('locationsSchema output', () => {
  it('defaults map to mode none and trims text', () => {
    const result = SvEn.parse({
      locations: [{ ...minimalLocation, name: '  Pizzeria Exempel ' }],
    });
    const location: Location = result.locations[0] as Location;
    expect(location.map).toEqual({ mode: 'none' });
    expect(location.name).toBe('Pizzeria Exempel');
    expect('email' in location).toBe(false);
  });

  it('keeps a full location unchanged', () => {
    const result: Locations = SvEn.parse({ locations: [fullLocation] });
    expect(result.locations[0]).toEqual(fullLocation);
  });
});

describe('locationsSchema issues', () => {
  it('reports a repeated id at the later entry', () => {
    const third = { ...minimalLocation, id: 'sodermalm' };
    expect(issues({ locations: [fullLocation, minimalLocation, third] })).toEqual([
      { path: ['locations', 2, 'id'], code: 'custom' },
    ]);
  });

  it('reports every repeat once per later entry', () => {
    expect(issues({ locations: [minimalLocation, minimalLocation, minimalLocation] })).toEqual([
      { path: ['locations', 1, 'id'], code: 'custom' },
      { path: ['locations', 2, 'id'], code: 'custom' },
    ]);
  });

  it('skips ids that LocationId already rejected: one issue per invalid id', () => {
    const bad = { ...minimalLocation, id: 'A B' };
    expect(issues({ locations: [bad, bad] })).toEqual([
      { path: ['locations', 0, 'id'], code: 'invalid_format' },
      { path: ['locations', 1, 'id'], code: 'invalid_format' },
    ]);
  });

  it('still reports a repeated valid id when other fields fail', () => {
    const badPhone = { ...minimalLocation, phone: '08-123' };
    expect(issues({ locations: [minimalLocation, badPhone] })).toEqual([
      { path: ['locations', 1, 'phone'], code: 'invalid_format' },
      { path: ['locations', 1, 'id'], code: 'custom' },
    ]);
  });

  it.each([
    [{ lat: 99, lng: 18 }, ['locations', 0, 'geo', 'lat'], 'too_big'],
    [{ lat: 59 }, ['locations', 0, 'geo', 'lng'], 'invalid_type'],
    ['59.3,18.0', ['locations', 0, 'geo'], 'invalid_type'],
  ])('gives an invalid geo %j on a click-to-load map exactly one issue', (geo, path, code) => {
    expect(issues({ locations: [{ ...fullLocation, geo }] })).toEqual([{ path, code }]);
  });

  it.each(SINGLE_LINE_TEXT_UNSAFE.map(([name, value]) => [name, value]))(
    'a name, street or city with %s is one invalid_format issue (#157)',
    (_, value) => {
      expect(issues({ locations: [{ ...minimalLocation, name: value }] })).toEqual([
        { path: ['locations', 0, 'name'], code: 'invalid_format' },
      ]);
      for (const field of ['street', 'city'] as const) {
        const address = { ...minimalLocation.address, [field]: value };
        expect(issues({ locations: [{ ...minimalLocation, address }] })).toEqual([
          { path: ['locations', 0, 'address', field], code: 'invalid_format' },
        ]);
      }
    },
  );

  it('does not crash on entries that are not objects', () => {
    expect(issues({ locations: [null, minimalLocation] })).toEqual([
      { path: ['locations', 0], code: 'invalid_type' },
    ]);
    expect(issues({ locations: [{ ...minimalLocation, map: null }] })).toEqual([
      { path: ['locations', 0, 'map'], code: 'invalid_type' },
    ]);
  });

  it('reports a click-to-load map without geo at geo', () => {
    expect(issues({ locations: [omit(fullLocation, 'geo')] })).toEqual([
      { path: ['locations', 0, 'geo'], code: 'custom' },
    ]);
  });

  it('reports an unknown key at the object that holds it', () => {
    const result = SvEn.safeParse({
      locations: [{ ...minimalLocation, address: { ...minimalLocation.address, zip: '1' } }],
    });
    expect(result.error?.issues).toEqual([
      expect.objectContaining({
        code: 'unrecognized_keys',
        keys: ['zip'],
        path: ['locations', 0, 'address'],
      }),
    ]);
  });

  it('reports a missing delivery-area translation as missing_locale', () => {
    const result = SvEn.safeParse({
      locations: [{ ...minimalLocation, deliveryArea: { sv: 'Söder' } }],
    });
    expect(result.error?.issues).toEqual([
      expect.objectContaining({
        code: 'custom',
        path: ['locations', 0, 'deliveryArea', 'en'],
        params: { pwpCode: 'missing_locale', locale: 'en' },
      }),
    ]);
  });

  it('reports a non-https order link as unsafe_url with the allowed scheme', () => {
    const result = SvEn.safeParse({
      locations: [{ ...minimalLocation, orderUrl: 'tel:+46812345678' }],
    });
    expect(result.error?.issues).toEqual([
      expect.objectContaining({
        code: 'custom',
        path: ['locations', 0, 'orderUrl'],
        params: { pwpCode: 'unsafe_url', allowedSchemes: ['https:'] },
      }),
    ]);
  });
});

describe('PostalCode', () => {
  it('accepts NNN NN only', () => {
    expect(PostalCode.safeParse('118 46').success).toBe(true);
    expect(PostalCode.safeParse('11846').success).toBe(false);
  });
});

describe('GeoPoint', () => {
  it('rejects infinite coordinates', () => {
    expect(GeoPoint.safeParse({ lat: Number.POSITIVE_INFINITY, lng: 0 }).success).toBe(false);
  });
});

describe('HttpsUrl', () => {
  it.each(['javascript:alert(1)', 'http://x.se', 'tel:+46812345678'])(
    'gives exactly one https-only unsafe_url issue for %s',
    (value) => {
      expect(HttpsUrl.safeParse(value).error?.issues).toEqual([
        expect.objectContaining({
          code: 'custom',
          path: [],
          params: { pwpCode: 'unsafe_url', allowedSchemes: ['https:'] },
        }),
      ]);
    },
  );

  it('rejects every unsafe SafeUrl fixture', () => {
    for (const value of safeUrlFixtures.invalid) {
      expect(HttpsUrl.safeParse(value).success, label(value)).toBe(false);
    }
  });

  it('accepts exactly the https SafeUrl fixtures', () => {
    for (const value of safeUrlFixtures.valid) {
      const isHttps = typeof value === 'string' && value.startsWith('https://');
      expect(HttpsUrl.safeParse(value).success, label(value)).toBe(isHttps);
    }
  });
});
