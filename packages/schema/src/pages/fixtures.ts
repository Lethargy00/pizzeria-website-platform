/**
 * Valid and invalid fixtures for `@pwp/schema/pages` (#28), in input form (ADR 0003 section 5).
 * Used by `pages.test.ts`. Not exported from `@pwp/schema/pages`.
 *
 * All names and texts are fictional.
 */
import type { Fixtures } from '../primitives/fixtures.js';

const NOT_OBJECTS = [undefined, null, 1, 'x', true, []] as const;

/** A valid Swedish page. */
export const aboutSv = {
  key: 'about',
  locale: 'sv',
  title: 'Om oss',
  description: 'Familjen bakom Pizzeria Exempel och vår surdeg.',
} as const;

/** The English translation of {@link aboutSv}. */
export const aboutEn = {
  key: 'about',
  locale: 'en',
  title: 'About us',
  description: 'The family behind Pizzeria Exempel and our sourdough.',
} as const;

/** Fixtures for a tenant with `locales: ['sv', 'en']`. */
export const frontMatterSvEnFixtures: Fixtures = {
  valid: [
    aboutSv,
    aboutEn,
    { ...aboutSv, key: 'privacy', title: 'Integritetspolicy' },
    { ...aboutSv, key: 'lunch-2026' },
    { ...aboutSv, title: 'T'.repeat(120), description: 'D'.repeat(300) },
    { ...aboutSv, title: '  Om oss  ' },
  ],
  invalid: [
    ...NOT_OBJECTS,
    {},
    { ...aboutSv, extra: true },
    { ...aboutSv, slug: 'about' },
    { ...aboutSv, key: 'About' },
    { ...aboutSv, key: '../about' },
    { ...aboutSv, key: 'about/us' },
    { ...aboutSv, key: '' },
    { ...aboutSv, key: 1 },
    { ...aboutSv, locale: 'de' },
    { ...aboutSv, locale: 'SV' },
    { ...aboutSv, locale: 'sv-SE' },
    { ...aboutSv, locale: ['sv'] },
    { ...aboutSv, title: '' },
    { ...aboutSv, title: '   ' },
    { ...aboutSv, title: 'Om\noss' },
    { ...aboutSv, title: 'Om\r\noss' },
    { ...aboutSv, title: 'T'.repeat(121) },
    { ...aboutSv, title: { sv: 'Om oss' } },
    { ...aboutSv, description: '' },
    { ...aboutSv, description: 'D'.repeat(301) },
    { ...aboutSv, description: 'rad ett\nrad två' },
    { key: 'about', locale: 'sv', title: 'Om oss' },
    { key: 'about', locale: 'sv', description: 'x' },
    { locale: 'sv', title: 'Om oss', description: 'x' },
    { key: 'about', title: 'Om oss', description: 'x' },
  ],
};

/** Fixtures for a tenant with `locales: ['sv']`: pages in other locales are rejected. */
export const frontMatterSvFixtures: Fixtures = {
  valid: [aboutSv],
  invalid: [aboutEn, { ...aboutSv, locale: 'de' }],
};
