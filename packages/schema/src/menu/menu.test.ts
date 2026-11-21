import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import * as menuModule from './index.js';
import {
  ALLERGENS,
  DIETARY_TAGS,
  ItemOverride,
  WEEKDAYS,
  checkMenuLocations,
  menuSchema,
  type Menu,
} from './index.js';
import {
  MENU_FIXTURE_CONTEXT,
  MENU_FIXTURE_LOCATION_IDS,
  invalidMenuFixtures,
  minimalMenu,
  realisticMenu,
  validMenuFixtures,
  withItem,
} from './fixtures.js';

const schema = menuSchema(MENU_FIXTURE_CONTEXT);

describe('menuSchema: valid fixtures', () => {
  it.each(validMenuFixtures.map((f) => [f.name, f.input]))('accepts %s', (_, input) => {
    const result = schema.safeParse(input);
    expect(result.error?.issues).toBeUndefined();
    expect(result.success).toBe(true);
  });
});

describe('menuSchema: invalid fixtures', () => {
  it.each(invalidMenuFixtures.map((f) => [f.name, f.input, f.path]))(
    'rejects %s',
    (_, input, path) => {
      const result = schema.safeParse(input);
      expect(result.success).toBe(false);
      expect(result.error?.issues.map((issue) => issue.path)).toContainEqual(path);
    },
  );
});

describe('menuSchema: output', () => {
  const menu: Menu = schema.parse(realisticMenu);

  it('turns kronor into integer öre', () => {
    const margherita = menu.categories[0]?.items[0];
    expect(margherita?.sizes?.map((s) => s.price)).toEqual([11500, 24900]);
    expect(menu.categories[0]?.items[1]?.sizes?.[0]?.price).toBe(12950);
    expect(menu.categories[1]?.items[0]?.price).toBe(3995);
    expect(menu.overrides?.['vasastan']?.items['margherita']?.sizes?.['family']).toBe(25900);
    expect(menu.overrides?.['vasastan']?.items['lattol']?.price).toBe(4200);
  });

  it('defaults soldOut to false and keeps true', () => {
    expect(menu.categories[0]?.items.map((i) => i.soldOut)).toEqual([false, false, true]);
  });

  it('keeps categories and items in file order', () => {
    expect(menu.categories.map((c) => c.id)).toEqual(['pizzor', 'drycker']);
    expect(menu.categories[0]?.items.map((i) => i.id)).toEqual(['margherita', 'diavola', 'vegana']);
  });

  it('does not change its input', () => {
    const copy = JSON.parse(JSON.stringify(realisticMenu)) as unknown;
    schema.parse(copy);
    expect(copy).toEqual(realisticMenu);
  });
});

describe('enums', () => {
  it('lists exactly the 14 EU allergens', () => {
    expect(ALLERGENS).toEqual([
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
    ]);
  });

  it('has the dietary tags and weekdays of the contract', () => {
    expect(DIETARY_TAGS).toEqual(['vegan', 'vegetarian', 'gluten-free', 'lactose-free']);
    expect(WEEKDAYS).toEqual([
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
      'sunday',
    ]);
  });
});

describe('locale context', () => {
  it('a menu for [sv] rejects an en text', () => {
    const result = menuSchema({ locales: ['sv'] }).safeParse(minimalMenu);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({
      code: 'unrecognized_keys',
      keys: ['en'],
    });
  });

  it('a menu for [sv] accepts sv-only texts', () => {
    const svOnly = {
      categories: [
        { id: 'pizzor', name: { sv: 'Pizzor' }, items: [{ id: 'a', name: { sv: 'A' }, price: 1 }] },
      ],
    };
    expect(menuSchema({ locales: ['sv'] }).safeParse(svOnly).success).toBe(true);
  });
});

describe('cross-file checks', () => {
  it('reports every issue in one run once the structure is valid', () => {
    const input = {
      ...realisticMenu,
      overrides: {
        sodermalm: {
          items: {
            calzone: { price: 1 },
            margherita: { price: 1, sizes: { xl: 1 } },
          },
        },
      },
    };
    const paths = schema.safeParse(input).error?.issues.map((i) => i.path);
    expect(paths).toEqual([
      ['overrides', 'sodermalm', 'items', 'calzone'],
      ['overrides', 'sodermalm', 'items', 'margherita', 'price'],
      ['overrides', 'sodermalm', 'items', 'margherita', 'sizes', 'xl'],
    ]);
  });

  it('checkMenuLocations accepts known location ids', () => {
    const menu = schema.parse(realisticMenu);
    expect(checkMenuLocations(menu, MENU_FIXTURE_LOCATION_IDS)).toEqual([]);
    expect(checkMenuLocations(schema.parse(minimalMenu), [])).toEqual([]);
  });

  it('checkMenuLocations reports an unknown location id at its key', () => {
    const menu = schema.parse(realisticMenu);
    const issues = checkMenuLocations(menu, ['sodermalm']);
    expect(issues).toEqual([
      expect.objectContaining({ code: 'custom', path: ['overrides', 'vasastan'] }),
    ]);
    expect(issues[0]?.message).toContain('vasastan');
    expect(new z.ZodError(issues).issues).toHaveLength(1);
  });
});

describe('ItemOverride', () => {
  it('is context-free and strict', () => {
    expect(ItemOverride.safeParse({ available: false }).success).toBe(true);
    expect(ItemOverride.safeParse({ hidden: true }).success).toBe(false);
  });
});

describe('plain-text descriptions', () => {
  it('keeps text as written; rendering escapes it', () => {
    const md = '**Stark** <b>salami</b>';
    const menu = schema.parse(withItem({ description: { sv: md, en: md } }));
    expect(menu.categories[0]?.items[0]?.description?.sv).toBe(md);
  });
});

describe('public surface', () => {
  it('exports the documented names only', () => {
    expect(Object.keys(menuModule).sort()).toEqual(
      [
        'ALLERGENS',
        'Allergen',
        'DIETARY_TAGS',
        'DietaryTag',
        'ItemOverride',
        'LocationOverride',
        'MAX_SPICY_LEVEL',
        'MENU_LIMITS',
        'MenuId',
        'SpicyLevel',
        'WEEKDAYS',
        'Weekday',
        'checkMenuLocations',
        'lunchSchema',
        'menuCategorySchema',
        'menuItemSchema',
        'menuSchema',
        'specialSchema',
      ].sort(),
    );
  });
});

/** The `[code, path]` of every issue, in order. */
function issuesOf(input: unknown): [string, PropertyKey[]][] {
  return (schema.safeParse(input).error?.issues ?? []).map((i) => [i.code, i.path]);
}

describe('one issue per mistake (no follow-up issue for a value a primitive rejected)', () => {
  const name = { sv: 'X', en: 'X' };
  const bad = 'Bad Id';

  it('a repeated invalid item id gives only the format issue for each id', () => {
    const input = {
      categories: [
        {
          id: 'pizzor',
          name,
          items: [
            { id: bad, name, price: 1 },
            { id: bad, name, price: 1 },
          ],
        },
      ],
    };
    expect(issuesOf(input)).toEqual([
      ['invalid_format', ['categories', 0, 'items', 0, 'id']],
      ['invalid_format', ['categories', 0, 'items', 1, 'id']],
    ]);
  });

  it('a repeated invalid category id gives only the format issues', () => {
    const category = { id: bad, name, items: [{ id: 'a', name, price: 1 }] };
    const input = { categories: [category, { ...category, items: [{ id: 'b', name, price: 1 }] }] };
    expect(issuesOf(input)).toEqual([
      ['invalid_format', ['categories', 0, 'id']],
      ['invalid_format', ['categories', 1, 'id']],
    ]);
  });

  it('a repeated invalid size or extra id gives only the format issues', () => {
    const sizes = withItem({
      price: undefined,
      sizes: [
        { id: bad, name, price: 1 },
        { id: bad, name, price: 2 },
      ],
    });
    expect(issuesOf(sizes)).toEqual([
      ['invalid_format', ['categories', 0, 'items', 0, 'sizes', 0, 'id']],
      ['invalid_format', ['categories', 0, 'items', 0, 'sizes', 1, 'id']],
    ]);
    const extras = withItem({
      extras: [
        { id: bad, name, price: 1 },
        { id: bad, name, price: 2 },
      ],
    });
    expect(issuesOf(extras)).toEqual([
      ['invalid_format', ['categories', 0, 'items', 0, 'extras', 0, 'id']],
      ['invalid_format', ['categories', 0, 'items', 0, 'extras', 1, 'id']],
    ]);
  });

  it('a repeated invalid date gives only the format issues', () => {
    const input = {
      ...minimalMenu,
      specials: [{ id: 'jul', name, price: 1, dates: ['2026-02-30', '2026-02-30'] }],
    };
    expect(issuesOf(input)).toEqual([
      ['invalid_format', ['specials', 0, 'dates', 0]],
      ['invalid_format', ['specials', 0, 'dates', 1]],
    ]);
  });

  it('a repeated invalid allergen gives only the enum issues', () => {
    expect(issuesOf(withItem({ allergens: ['tomato', 'tomato'] }))).toEqual([
      ['invalid_value', ['categories', 0, 'items', 0, 'allergens', 0]],
      ['invalid_value', ['categories', 0, 'items', 0, 'allergens', 1]],
    ]);
  });

  it('a valid repeated id still gives exactly one duplicate issue', () => {
    const input = {
      categories: [
        {
          id: 'pizzor',
          name,
          items: [
            { id: 'a', name, price: 1 },
            { id: 'a', name, price: 1 },
          ],
        },
      ],
    };
    expect(issuesOf(input)).toEqual([['custom', ['categories', 0, 'items', 1, 'id']]]);
  });

  it('lunch start 25:00 gives exactly one issue, not also "end after start"', () => {
    const input = { ...minimalMenu, lunch: { ...realisticMenu.lunch, start: '25:00' } };
    expect(issuesOf(input)).toEqual([['invalid_format', ['lunch', 'start']]]);
  });

  it('lunch end 2pm gives exactly one issue', () => {
    const input = { ...minimalMenu, lunch: { ...realisticMenu.lunch, end: '2pm' } };
    expect(issuesOf(input)).toEqual([['invalid_format', ['lunch', 'end']]]);
  });

  it('an override keyed by an invalid item id gives only the key issue', () => {
    const input = { ...minimalMenu, overrides: { sodermalm: { items: { [bad]: { price: 1 } } } } };
    expect(issuesOf(input)).toEqual([['invalid_key', ['overrides', 'sodermalm', 'items', bad]]]);
  });

  it('an override of an invalid size id gives only the key issue', () => {
    const input = {
      ...realisticMenu,
      overrides: { sodermalm: { items: { margherita: { sizes: { [bad]: 1 } } } } },
    };
    expect(issuesOf(input)).toEqual([
      ['invalid_key', ['overrides', 'sodermalm', 'items', 'margherita', 'sizes', bad]],
    ]);
  });
});
