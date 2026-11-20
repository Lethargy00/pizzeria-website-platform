/**
 * Valid and invalid fixtures for the theme token contract (#34). Used by `theme.test.ts`; the
 * token pipeline (#35) and contrast gate (#36) tests may copy {@link exampleTheme} as a mock.
 * Not exported from `@pwp/schema/theme`.
 *
 * Security: every string token is checked against {@link CSS_INJECTION_PAYLOADS}. Add any new
 * payload there; it must be rejected by every string field.
 */
import type { Fixtures } from '../primitives/fixtures.js';

const NOT_STRINGS = [undefined, null, 1, true, [], {}] as const;

/** Strings that would break out of, or smuggle code into, a CSS declaration. */
export const CSS_INJECTION_PAYLOADS = [
  'url(https://evil.example/x.png)',
  'url("javascript:alert(1)")',
  '#fff;background:url(x)',
  '#fff; }',
  '#fff}body{display:none',
  '@import "https://evil.example/x.css"',
  '@import url(x)',
  'expression(alert(1))',
  'red;expression(alert(1))',
  'oklch(0.5 0.1 120);color:red',
  'oklch(0.5 0.1 120)}',
  '1rem;}',
  '1rem/**/',
  '1rem\\;',
  'var(--x)',
  'calc(1rem + 1px)',
  'env(safe-area-inset-top)',
  'attr(data-x)',
  'image-set("x.png" 1x)',
  '</style><script>alert(1)</script>',
  'Inter", "x',
  "Inter', 'x",
  'Inter\\"',
  'Inter;',
  'Inter\n}',
  '-moz-binding:url(x)',
  'behavior:url(x.htc)',
  '\u0000#fff',
  '#fff\u0000',
  '#fff ',
  ' #fff',
  '#fff\n',
] as const;

export const hexColorFixtures: Fixtures = {
  valid: ['#fff', '#FFF', '#fffaf0', '#1A2B3C', '#000000'],
  invalid: [
    ...NOT_STRINGS,
    '',
    'fff',
    '#ff',
    '#ffff',
    '#fffff',
    '#fffffff',
    '#ffffffff',
    '#ggg',
    'red',
    'transparent',
    'currentColor',
    'rgb(0,0,0)',
    ...CSS_INJECTION_PAYLOADS,
  ],
};

export const oklchColorFixtures: Fixtures = {
  valid: [
    'oklch(0 0 0)',
    'oklch(1 0 0)',
    'oklch(0.628 0.258 29.23)',
    'oklch(62.8% 0.258 29.23)',
    'oklch(100% 0 360)',
    'oklch(0% 0.4 0)',
    'oklch(0.5 0.1234 359.99)',
  ],
  invalid: [
    ...NOT_STRINGS,
    '',
    'oklch()',
    'oklch(0.5 0.1)',
    'oklch(0.5 0.1 120 / 0.5)',
    'oklch(0.5 0.1 120deg)',
    'oklch(0.5, 0.1, 120)',
    'oklch(0.5  0.1 120)',
    'oklch( 0.5 0.1 120)',
    'OKLCH(0.5 0.1 120)',
    'oklch(1.1 0.1 120)',
    'oklch(101% 0.1 120)',
    'oklch(0.5 1 120)',
    'oklch(0.5 0.1 361)',
    'oklch(0.5 0.1 -1)',
    'oklch(-0.1 0.1 120)',
    'oklch(none 0.1 120)',
    'oklch(from red l c h)',
    'oklch(0.5 0.1 120',
    'oklab(0.5 0.1 0.1)',
    ...CSS_INJECTION_PAYLOADS,
  ],
};

export const lengthFixtures: Fixtures = {
  valid: ['0', '0px', '1px', '4px', '1rem', '0.75rem', '1.125rem', '1.5em', '999px', '999.999rem'],
  invalid: [
    ...NOT_STRINGS,
    '',
    '1',
    '16',
    '.5rem',
    '1.rem',
    '1 rem',
    '1REM',
    '1pt',
    '1vh',
    '50%',
    '-1px',
    '+1px',
    '1000px',
    '1.00001rem',
    '01px',
    '1e3px',
    ...CSS_INJECTION_PAYLOADS,
  ],
};

export const signedLengthFixtures: Fixtures = {
  valid: ['0', '1px', '-1px', '-0.5rem', '2px'],
  invalid: [...NOT_STRINGS, '', '--1px', '- 1px', '-0', '+1px', '-1', ...CSS_INJECTION_PAYLOADS],
};

export const fontNameFixtures: Fixtures = {
  valid: ['Inter', 'Playfair Display', 'Source Sans 3', 'Fira-Code', 'A'],
  invalid: [
    ...NOT_STRINGS,
    '',
    ' Inter',
    'Inter ',
    'Playfair  Display',
    'Inter,serif',
    'Inter, sans-serif',
    '"Inter"',
    "'Inter'",
    'Inter_Bold',
    'Gröna',
    'a'.repeat(65),
    ...CSS_INJECTION_PAYLOADS,
  ],
};

export const fontWeightFixtures: Fixtures = {
  valid: [100, 400, 700, 900],
  invalid: [...NOT_STRINGS.filter((v) => typeof v !== 'number'), 0, 50, 450, 1000, 400.5, '400'],
};

export const lineHeightFixtures: Fixtures = {
  valid: [1, 1.2, 1.5, 3],
  invalid: [...NOT_STRINGS.filter((v) => typeof v !== 'number'), 0, 0.9, 3.1, '1.5', '1.5rem'],
};

const face = (src: string, weight: number, style = 'normal') => ({ src, weight, style });

/** A complete, valid token set. Free to copy as a mock for #35, #36 and #37–#39. */
export const exampleTheme = {
  colors: {
    light: {
      bg: '#fffaf0',
      surface: '#ffffff',
      text: '#1f1a17',
      muted: '#5c534d',
      primary: '#8b1e1e',
      onPrimary: '#ffffff',
      accent: 'oklch(0.72 0.12 85)',
      onAccent: '#1f1a17',
      border: '#d9cfc4',
      focus: '#1d4ed8',
      danger: '#b42318',
      success: '#1e6b3a',
    },
    dark: {
      bg: '#1a1513',
      surface: '#26201d',
      text: '#f5efe9',
      muted: '#c4b8ae',
      primary: '#f08c7d',
      onPrimary: '#1a1513',
      accent: 'oklch(80% 0.12 85)',
      onAccent: '#1a1513',
      border: '#4a403a',
      focus: '#93c5fd',
      danger: '#fda29b',
      success: '#86d19f',
    },
  },
  typography: {
    body: {
      name: 'Source Sans 3',
      faces: [
        face('assets/fonts/source-sans-3-regular.woff2', 400),
        face('assets/fonts/source-sans-3-italic.woff2', 400, 'italic'),
        face('assets/fonts/source-sans-3-bold.woff2', 700),
      ],
      fallback: 'sans-serif',
    },
    heading: {
      name: 'Playfair Display',
      faces: [face('assets/fonts/playfair-display-bold.woff2', 700)],
      fallback: 'serif',
    },
    scale: {
      xs: '0.75rem',
      sm: '0.875rem',
      base: '1rem',
      lg: '1.125rem',
      xl: '1.25rem',
      '2xl': '1.5rem',
      '3xl': '2rem',
      '4xl': '2.5rem',
    },
    weights: { body: 400, heading: 700, strong: 700 },
    lineHeights: { body: 1.6, heading: 1.2 },
  },
  spacing: {
    xs: '0.25rem',
    sm: '0.5rem',
    md: '1rem',
    lg: '1.5rem',
    xl: '2rem',
    '2xl': '3rem',
  },
  radius: { sm: '2px', md: '6px', lg: '12px' },
  shadows: {
    sm: 'none',
    md: { x: '0', y: '1px', blur: '3px', spread: '0', color: '#000000', opacity: 0.12 },
    lg: { x: '0', y: '8px', blur: '24px', spread: '-4px', color: '#000', opacity: 0.18 },
  },
  buttonStyle: 'rounded',
  imageTreatment: 'framed',
  darkMode: 'system',
};

/** Valid tenant overrides. */
export const validOverrides: readonly unknown[] = [
  {},
  { colors: { light: { primary: '#0b5d1e' } } },
  { colors: { dark: { primary: 'oklch(0.8 0.1 140)', onPrimary: '#000' } } },
  { typography: { scale: { base: '1.0625rem' } } },
  {
    typography: {
      heading: {
        name: 'Tenant Display',
        faces: [face('assets/fonts/tenant-display.woff2', 800)],
        fallback: 'serif',
      },
    },
  },
  { shadows: { md: 'none' } },
  { buttonStyle: 'pill', imageTreatment: 'full-bleed', darkMode: 'never' },
  { logo: 'assets/logo.png' },
];

/** Invalid tenant overrides: each must be rejected. */
export const invalidOverrides: readonly unknown[] = [
  undefined,
  null,
  1,
  'theme',
  [],
  { colour: { light: {} } },
  { colors: { light: { primary: 'red' } } },
  { colors: { light: { brand: '#fff' } } },
  { colors: { sepia: { bg: '#fff' } } },
  { colors: { light: { bg: 'url(https://evil.example/x.png)' } } },
  { colors: { light: { bg: '#fff;}body{background:url(x)' } } },
  { typography: { scale: { base: '1rem;}' } } },
  { typography: { scale: { huge: '5rem' } } },
  { typography: { body: { name: 'Inter' } } },
  { typography: { body: { name: 'Inter', faces: [], fallback: 'sans-serif' } } },
  {
    typography: {
      body: {
        name: 'Inter',
        faces: [face('https://fonts.example/inter.woff2', 400)],
        fallback: 'sans-serif',
      },
    },
  },
  {
    typography: {
      body: {
        name: 'Inter',
        faces: [face('assets/fonts/inter.ttf', 400)],
        fallback: 'sans-serif',
      },
    },
  },
  {
    typography: {
      body: {
        name: 'Inter',
        faces: [face('assets/fonts/inter.woff2', 400)],
        fallback: 'Arial',
      },
    },
  },
  {
    typography: {
      body: {
        name: 'Inter',
        faces: [{ ...face('assets/fonts/inter.woff2', 400), unicodeRange: 'U+0-7F' }],
        fallback: 'sans-serif',
      },
    },
  },
  { spacing: { md: '1rem', gutter: '2rem' } },
  { radius: { md: 'calc(1rem + 1px)' } },
  { shadows: { md: '0 1px 3px #000' } },
  { shadows: { md: { x: '0', y: '1px', blur: '3px', spread: '0', color: '#000' } } },
  { buttonStyle: 'ghost' },
  { imageTreatment: 'circle' },
  { darkMode: true },
  { logo: 'assets/logo.svg' },
  { logo: 'https://evil.example/logo.png' },
  { css: 'body{display:none}' },
  { customCss: '@import url(x)' },
];
