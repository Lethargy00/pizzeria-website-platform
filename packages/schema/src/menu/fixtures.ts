/**
 * Valid and invalid fixtures for `menuSchema` (#25), in **input** form (prices in kronor, as a
 * tenant writes them in `menu.yaml`). Used by `menu.test.ts`; other schema tests in this package
 * may import them. Not exported from `@pwp/schema/menu`.
 *
 * `realisticMenu` doubles as the mock for consumers (#32, #33): two locations, pizzas with sizes
 * and extras, a lunch menu, specials and overrides.
 */
import type { LocaleContext } from '../primitives/index.js';

/** The context every fixture is written for. */
export const MENU_FIXTURE_CONTEXT: LocaleContext = { locales: ['sv', 'en'] };

/** Location ids the fixture's overrides refer to (as in a matching `locations.yaml`). */
export const MENU_FIXTURE_LOCATION_IDS = ['sodermalm', 'vasastan'] as const;

const t = (sv: string, en: string) => ({ sv, en });

export const realisticMenu = {
  categories: [
    {
      id: 'pizzor',
      name: t('Pizzor', 'Pizzas'),
      description: t('Alla pizzor bakas i stenugn.', 'All pizzas are baked in a stone oven.'),
      items: [
        {
          id: 'margherita',
          name: t('Margherita', 'Margherita'),
          description: t('Tomatsås, mozzarella, basilika.', 'Tomato sauce, mozzarella, basil.'),
          image: 'assets/menu/margherita.webp',
          imageAlt: t('En margherita med basilika', 'A margherita with basil'),
          sizes: [
            { id: 'normal', name: t('Normal', 'Regular'), price: 115 },
            { id: 'family', name: t('Familj', 'Family'), price: 249 },
          ],
          extras: [
            {
              id: 'extra-cheese',
              name: t('Extra ost', 'Extra cheese'),
              price: 15,
              allergens: ['milk'],
            },
            { id: 'garlic', name: t('Vitlök', 'Garlic'), price: 0 },
          ],
          allergens: ['gluten', 'milk'],
          dietary: ['vegetarian'],
        },
        {
          id: 'diavola',
          name: t('Diavola', 'Diavola'),
          description: t(
            'Tomatsås, mozzarella, salami piccante.',
            'Tomato sauce, mozzarella, spicy salami.',
          ),
          sizes: [
            { id: 'normal', name: t('Normal', 'Regular'), price: 129.5 },
            { id: 'family', name: t('Familj', 'Family'), price: 269 },
          ],
          allergens: ['gluten', 'milk', 'mustard'],
          spicy: 2,
        },
        {
          id: 'vegana',
          name: t('Vegana', 'Vegana'),
          price: 125,
          allergens: ['gluten'],
          dietary: ['vegan', 'vegetarian', 'lactose-free'],
          soldOut: true,
        },
      ],
    },
    {
      id: 'drycker',
      name: t('Drycker', 'Drinks'),
      items: [
        { id: 'lattol', name: t('Lättöl', 'Light beer'), price: 39.95, allergens: ['gluten'] },
      ],
    },
  ],
  lunch: {
    title: t('Dagens lunch', 'Lunch of the day'),
    description: t('Inklusive sallad, bröd och kaffe.', 'Includes salad, bread and coffee.'),
    weekdays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
    start: '11:00',
    end: '14:00',
    items: [
      {
        id: 'lunch-pizza',
        name: t('Valfri pizza', 'Any pizza'),
        price: 105,
        allergens: ['gluten', 'milk'],
      },
      {
        id: 'lunch-pasta',
        name: t('Pasta carbonara', 'Pasta carbonara'),
        price: 115,
        allergens: ['gluten', 'eggs', 'milk'],
      },
    ],
  },
  specials: [
    {
      id: 'fredagspizza',
      name: t('Fredagspizza', 'Friday pizza'),
      price: 99,
      weekdays: ['friday'],
      allergens: ['gluten', 'milk'],
    },
    {
      id: 'julpizza',
      name: t('Julpizza', 'Christmas pizza'),
      description: t('Skinka, senap och rödkål.', 'Ham, mustard and red cabbage.'),
      price: 145,
      dates: ['2026-12-23', '2026-12-24'],
      allergens: ['gluten', 'milk', 'mustard'],
    },
  ],
  overrides: {
    vasastan: {
      items: {
        margherita: { sizes: { family: 259 } },
        vegana: { soldOut: false },
        'lunch-pasta': { available: false },
        lattol: { price: 42 },
      },
    },
  },
};

/** A minimal valid menu: one category, one single-price item. */
export const minimalMenu = {
  categories: [
    {
      id: 'pizzor',
      name: t('Pizzor', 'Pizzas'),
      items: [{ id: 'margherita', name: t('Margherita', 'Margherita'), price: 99 }],
    },
  ],
};

export const validMenuFixtures: readonly { readonly name: string; readonly input: unknown }[] = [
  { name: 'realistic menu', input: realisticMenu },
  { name: 'minimal menu', input: minimalMenu },
  { name: 'free item (price 0)', input: withItem({ price: 0 }) },
  { name: 'every allergen once', input: withItem({ allergens: allAllergens() }) },
  {
    name: 'lunch on one day',
    input: { ...minimalMenu, lunch: { ...realisticMenu.lunch, weekdays: ['saturday'] } },
  },
];

/** A copy of {@link minimalMenu} whose only item has `fields` merged in (or removed when `undefined`). */
export function withItem(fields: Record<string, unknown>) {
  const merged = { id: 'margherita', name: t('Margherita', 'Margherita'), price: 99, ...fields };
  const item = Object.fromEntries(
    Object.entries(merged).filter(([, value]) => value !== undefined),
  );
  return { categories: [{ id: 'pizzor', name: t('Pizzor', 'Pizzas'), items: [item] }] };
}

function allAllergens(): string[] {
  return [
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
  ];
}

const lunch = realisticMenu.lunch;
const special = {
  id: 'fredagspizza',
  name: t('Fredagspizza', 'Friday pizza'),
  price: 99,
  weekdays: ['friday'],
};

/**
 * Invalid fixtures: each breaks one rule. `path` is where the (first) issue must be reported.
 */
export const invalidMenuFixtures: readonly {
  readonly name: string;
  readonly input: unknown;
  readonly path: readonly (string | number)[];
}[] = [
  { name: 'not an object', input: 'menu', path: [] },
  { name: 'no categories', input: { categories: [] }, path: ['categories'] },
  { name: 'unknown top-level key', input: { ...minimalMenu, cart: true }, path: [] },
  { name: 'unknown item key', input: withItem({ vat: 25 }), path: ['categories', 0, 'items', 0] },
  {
    name: 'free-text allergen',
    input: withItem({ allergens: ['gluten', 'tomato'] }),
    path: ['categories', 0, 'items', 0, 'allergens', 1],
  },
  {
    name: 'allergen in Swedish',
    input: withItem({ allergens: ['mjölk'] }),
    path: ['categories', 0, 'items', 0, 'allergens', 0],
  },
  {
    name: 'repeated allergen',
    input: withItem({ allergens: ['milk', 'milk'] }),
    path: ['categories', 0, 'items', 0, 'allergens', 1],
  },
  {
    name: 'unknown dietary tag',
    input: withItem({ dietary: ['halal'] }),
    path: ['categories', 0, 'items', 0, 'dietary', 0],
  },
  {
    name: 'spicy as a dietary tag',
    input: withItem({ dietary: ['spicy'] }),
    path: ['categories', 0, 'items', 0, 'dietary', 0],
  },
  {
    name: 'spicy level 0',
    input: withItem({ spicy: 0 }),
    path: ['categories', 0, 'items', 0, 'spicy'],
  },
  {
    name: 'spicy level 4',
    input: withItem({ spicy: 4 }),
    path: ['categories', 0, 'items', 0, 'spicy'],
  },
  {
    name: 'spicy level 1.5',
    input: withItem({ spicy: 1.5 }),
    path: ['categories', 0, 'items', 0, 'spicy'],
  },
  {
    name: 'no price and no sizes',
    input: withItem({ price: undefined }),
    path: ['categories', 0, 'items', 0, 'price'],
  },
  {
    name: 'price and sizes',
    input: withItem({ sizes: [{ id: 'normal', name: t('Normal', 'Regular'), price: 99 }] }),
    path: ['categories', 0, 'items', 0, 'sizes'],
  },
  {
    name: 'empty sizes',
    input: withItem({ price: undefined, sizes: [] }),
    path: ['categories', 0, 'items', 0, 'sizes'],
  },
  {
    name: 'size without a price',
    input: withItem({ price: undefined, sizes: [{ id: 'normal', name: t('Normal', 'Regular') }] }),
    path: ['categories', 0, 'items', 0, 'sizes', 0, 'price'],
  },
  {
    name: 'size with two prices',
    input: withItem({
      price: undefined,
      sizes: [{ id: 'normal', name: t('Normal', 'Regular'), price: 99, prices: [99, 109] }],
    }),
    path: ['categories', 0, 'items', 0, 'sizes', 0],
  },
  {
    name: 'duplicate size id',
    input: withItem({
      price: undefined,
      sizes: [
        { id: 'normal', name: t('Normal', 'Regular'), price: 99 },
        { id: 'normal', name: t('Stor', 'Large'), price: 129 },
      ],
    }),
    path: ['categories', 0, 'items', 0, 'sizes', 1, 'id'],
  },
  {
    name: 'duplicate extra id',
    input: withItem({
      extras: [
        { id: 'cheese', name: t('Ost', 'Cheese'), price: 15 },
        { id: 'cheese', name: t('Ost', 'Cheese'), price: 20 },
      ],
    }),
    path: ['categories', 0, 'items', 0, 'extras', 1, 'id'],
  },
  {
    name: 'price as text',
    input: withItem({ price: '99 kr' }),
    path: ['categories', 0, 'items', 0, 'price'],
  },
  {
    name: 'price with three decimals',
    input: withItem({ price: 99.999 }),
    path: ['categories', 0, 'items', 0, 'price'],
  },
  {
    name: 'negative price',
    input: withItem({ price: -1 }),
    path: ['categories', 0, 'items', 0, 'price'],
  },
  {
    name: 'missing en name',
    input: withItem({ name: { sv: 'Margherita' } }),
    path: ['categories', 0, 'items', 0, 'name', 'en'],
  },
  {
    name: 'name too long',
    input: withItem({ name: t('x'.repeat(2001), 'x') }),
    path: ['categories', 0, 'items', 0, 'name', 'sv'],
  },
  {
    name: 'image outside assets',
    input: withItem({ image: '../secret.jpg', imageAlt: t('x', 'x') }),
    path: ['categories', 0, 'items', 0, 'image'],
  },
  {
    name: 'image as SVG',
    input: withItem({ image: 'assets/pizza.svg', imageAlt: t('x', 'x') }),
    path: ['categories', 0, 'items', 0, 'image'],
  },
  {
    name: 'image without alt',
    input: withItem({ image: 'assets/pizza.webp' }),
    path: ['categories', 0, 'items', 0, 'imageAlt'],
  },
  {
    name: 'item id not a slug',
    input: withItem({ id: 'Margherita Pizza' }),
    path: ['categories', 0, 'items', 0, 'id'],
  },
  {
    name: 'soldOut as text',
    input: withItem({ soldOut: 'yes' }),
    path: ['categories', 0, 'items', 0, 'soldOut'],
  },
  {
    name: 'duplicate category id',
    input: {
      categories: [
        minimalMenu.categories[0],
        {
          ...minimalMenu.categories[0],
          items: [{ id: 'calzone', name: t('Calzone', 'Calzone'), price: 120 }],
        },
      ],
    },
    path: ['categories', 1, 'id'],
  },
  {
    name: 'duplicate item id across categories',
    input: {
      categories: [minimalMenu.categories[0], { ...minimalMenu.categories[0], id: 'ovrigt' }],
    },
    path: ['categories', 1, 'items', 0, 'id'],
  },
  {
    name: 'lunch item reuses a category item id',
    input: {
      ...minimalMenu,
      lunch: { ...lunch, items: [{ id: 'margherita', name: t('M', 'M'), price: 95 }] },
    },
    path: ['lunch', 'items', 0, 'id'],
  },
  {
    name: 'special reuses an item id',
    input: { ...minimalMenu, specials: [{ ...special, id: 'margherita' }] },
    path: ['specials', 0, 'id'],
  },
  {
    name: 'lunch ends before it starts',
    input: { ...minimalMenu, lunch: { ...lunch, start: '14:00', end: '11:00' } },
    path: ['lunch', 'end'],
  },
  {
    name: 'lunch ends when it starts',
    input: { ...minimalMenu, lunch: { ...lunch, start: '11:00', end: '11:00' } },
    path: ['lunch', 'end'],
  },
  {
    name: 'lunch time not HH:MM',
    input: { ...minimalMenu, lunch: { ...lunch, start: '11' } },
    path: ['lunch', 'start'],
  },
  {
    name: 'lunch on no days',
    input: { ...minimalMenu, lunch: { ...lunch, weekdays: [] } },
    path: ['lunch', 'weekdays'],
  },
  {
    name: 'lunch weekday abbreviated',
    input: { ...minimalMenu, lunch: { ...lunch, weekdays: ['mon'] } },
    path: ['lunch', 'weekdays', 0],
  },
  {
    name: 'special weekday abbreviated',
    input: { ...minimalMenu, specials: [{ ...special, weekdays: ['fri'] }] },
    path: ['specials', 0, 'weekdays', 0],
  },
  {
    name: 'lunch weekday in Swedish',
    input: { ...minimalMenu, lunch: { ...lunch, weekdays: ['måndag'] } },
    path: ['lunch', 'weekdays', 0],
  },
  {
    name: 'lunch repeated weekday',
    input: { ...minimalMenu, lunch: { ...lunch, weekdays: ['monday', 'monday'] } },
    path: ['lunch', 'weekdays', 1],
  },
  {
    name: 'lunch without items',
    input: { ...minimalMenu, lunch: { ...lunch, items: [] } },
    path: ['lunch', 'items'],
  },
  {
    name: 'special with no day',
    input: { ...minimalMenu, specials: [{ ...special, weekdays: undefined }] },
    path: ['specials', 0, 'dates'],
  },
  {
    name: 'special with dates and weekdays',
    input: { ...minimalMenu, specials: [{ ...special, dates: ['2026-12-24'] }] },
    path: ['specials', 0, 'weekdays'],
  },
  {
    name: 'special on a date that does not exist',
    input: {
      ...minimalMenu,
      specials: [{ ...special, weekdays: undefined, dates: ['2026-02-30'] }],
    },
    path: ['specials', 0, 'dates', 0],
  },
  {
    name: 'override of an unknown item',
    input: { ...minimalMenu, overrides: { sodermalm: { items: { calzone: { price: 110 } } } } },
    path: ['overrides', 'sodermalm', 'items', 'calzone'],
  },
  {
    name: 'override of an unknown size',
    input: {
      ...realisticMenu,
      overrides: { sodermalm: { items: { margherita: { sizes: { xl: 299 } } } } },
    },
    path: ['overrides', 'sodermalm', 'items', 'margherita', 'sizes', 'xl'],
  },
  {
    name: 'override sets one price on a sized item',
    input: {
      ...realisticMenu,
      overrides: { sodermalm: { items: { margherita: { price: 120 } } } },
    },
    path: ['overrides', 'sodermalm', 'items', 'margherita', 'price'],
  },
  {
    name: 'override location id not a slug',
    input: { ...minimalMenu, overrides: { Södermalm: { items: {} } } },
    path: ['overrides', 'Södermalm'],
  },
  {
    name: 'override with an unknown key',
    input: {
      ...minimalMenu,
      overrides: { sodermalm: { items: { margherita: { name: t('x', 'x') } } } },
    },
    path: ['overrides', 'sodermalm', 'items', 'margherita'],
  },
  {
    name: 'override price as text',
    input: { ...minimalMenu, overrides: { sodermalm: { items: { margherita: { price: '89' } } } } },
    path: ['overrides', 'sodermalm', 'items', 'margherita', 'price'],
  },
];
