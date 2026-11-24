/**
 * Valid and invalid fixtures for every primitive (#22). Used by `primitives.test.ts`; other schema
 * tests in this package may import them. Not exported from `@pwp/schema/primitives`.
 *
 * Security: add any missing obfuscation case to the `invalid` lists; a new case must fail.
 */
export interface Fixtures<T = unknown> {
  readonly valid: readonly T[];
  readonly invalid: readonly unknown[];
}

const NOT_STRINGS = [undefined, null, 1, true, [], {}] as const;

export const slugFixtures: Fixtures = {
  valid: ['a', 'roma', 'pizzeria-roma', 'lunch-2026', '0', 'a'.repeat(64)],
  invalid: [
    ...NOT_STRINGS,
    '',
    'Roma',
    'pizzeria_roma',
    'pizzeria roma',
    '-roma',
    'roma-',
    'piz--zeria',
    'a.b',
    '../x',
    'a/b',
    'å',
    'a'.repeat(65),
  ],
};

export const timeOfDayFixtures: Fixtures = {
  valid: ['00:00', '09:30', '11:00', '23:59', '12:05'],
  invalid: [
    ...NOT_STRINGS,
    '',
    '24:00',
    '9:30',
    '09:3',
    '09:60',
    '25:00',
    '09.30',
    '09:30:00',
    ' 09:30',
    'T09:30',
  ],
};

export const isoDateFixtures: Fixtures = {
  valid: ['2026-12-24', '2028-02-29', '2026-01-01', '2000-02-29'],
  invalid: [
    ...NOT_STRINGS,
    '',
    '2026-02-29',
    '1900-02-29',
    '2026-13-01',
    '2026-00-10',
    '2026-04-31',
    '2026-1-1',
    '24/12/2026',
    '2026-12-24T00:00:00Z',
    ' 2026-12-24',
  ],
};

export const emailFixtures: Fixtures = {
  valid: [
    'info@pizzeria-roma.se',
    'boka+lunch@roma.example.com',
    'a.b@c.de',
    'boka-bord@a-b.c-d.se',
    `${'a'.repeat(64)}@b.se`,
  ],
  invalid: [
    ...NOT_STRINGS,
    '',
    'info',
    'info@roma',
    '@roma.se',
    'info@@roma.se',
    'info @roma.se',
    'Roma <info@roma.se>',
    'info@roma.se\nBcc: x@evil.example',
    'info@[127.0.0.1]',
    `${'a'.repeat(250)}@b.se`,
    // Local part over 64 characters, hyphen at a label edge (#107)
    `${'a'.repeat(65)}@b.se`,
    'a@b-.se',
    'a@-b.se',
    'a@x.b-.se',
    'a@x.-b.se',
    'a@b.se-',
  ],
};

export const phoneNumberFixtures: Fixtures = {
  valid: ['+46812345678', '+46701234567', '+4581234567'],
  invalid: [
    ...NOT_STRINGS,
    '',
    '0812345678',
    '+46 8 123 456 78',
    '+46-8-12345678',
    '+0812345678',
    '+46',
    '46812345678',
    '+4681234567890123',
  ],
};

export const safeUrlFixtures: Fixtures = {
  valid: [
    'https://pizzeria-roma.se',
    'https://pizzeria-roma.se/',
    'https://www.example.com/meny?lang=sv#pizzor',
    'https://example.com:8443/x',
    'https://maps.example.com/?q=Storgatan%201',
    'https://xn--exmple-cua.se/',
    'https://a-b.c-d.se/x',
    'https://x.se:8080?q=1',
    'https://x.se:1/',
    'https://x.se:65535/',
    'https://x.se#top',
    'mailto:info@pizzeria-roma.se',
    'mailto:info@pizzeria-roma.se?subject=Bokning',
    'mailto:info@pizzeria-roma.se?subject=Bord%20f%C3%B6r%204&body=Hej',
    'mailto:info@pizzeria-roma.se?subject=Bokning&body=Rad%201%0D%0ARad%202',
    'tel:+46812345678',
    'tel:08-123-456-78',
    'tel:+46(0)8.123.456',
  ],
  invalid: [
    ...NOT_STRINGS,
    '',
    // Disallowed schemes
    'http://pizzeria-roma.se',
    'javascript:alert(1)',
    'vbscript:msgbox(1)',
    'data:text/html,<script>alert(1)</script>',
    'data:image/png;base64,iVBORw0KGgo=',
    'file:///etc/passwd',
    'ftp://example.com',
    'blob:https://example.com/x',
    'sms:+46812345678',
    // Mixed case
    'JavaScript:alert(1)',
    'JAVASCRIPT:alert(1)',
    'jAvAsCrIpT:alert(1)',
    'VBScript:msgbox(1)',
    'Data:text/html,x',
    'HTTPS://example.com',
    'Https://example.com',
    'MAILTO:a@b.se',
    // Whitespace and control-character obfuscation
    ' javascript:alert(1)',
    'javascript :alert(1)',
    'java\tscript:alert(1)',
    'java\nscript:alert(1)',
    'java\rscript:alert(1)',
    '\u0000javascript:alert(1)',
    '\u0001javascript:alert(1)',
    'javascript\u0000:alert(1)',
    '\u200bjavascript:alert(1)',
    'java\u200dscript:alert(1)',
    '\ufeffjavascript:alert(1)',
    '\u00a0javascript:alert(1)',
    '\u3000javascript:alert(1)',
    '\u202ejavascript:alert(1)',
    'https://example.com/\u202egnp.exe',
    'https://exa mple.com',
    'https://example.com\n',
    ' https://example.com',
    'https://example.com ',
    // Encoded or look-alike schemes
    '&#106;avascript:alert(1)',
    '&#x6A;avascript:alert(1)',
    '%6Aavascript:alert(1)',
    'javascript&colon;alert(1)',
    'ｊavascript:alert(1)',
    'https&#58;//example.com',
    // Protocol-relative, relative and backslash forms
    '//evil.example/x',
    '///evil.example',
    '\\\\evil.example\\x',
    '/\\evil.example',
    '/meny',
    'meny.html',
    '#top',
    '?q=1',
    'https:\\\\evil.example',
    'https:/\\evil.example',
    'https://evil.example\\@good.example',
    // Malformed https
    'https:evil.example',
    'https:/evil.example',
    'https:///evil.example',
    'https://',
    'https://localhost',
    'https://.example.com',
    'https://example.com.',
    'https://user:pass@example.com',
    'https://pizzeria-roma.se@evil.example',
    'https://pizzeria-roma.se%40evil.example',
    'https://[::1]/',
    // Raw host differs from the parsed host (#107 F1)
    'https://exаmple.se', // Cyrillic а
    'https://exämple.se/', // IDN must be written as xn--
    'https://ｅｘample.se',
    'https://x。se',
    'https://x．se',
    'https://x｡se',
    'https://ex%61mple.se',
    'https://evil%2ecom',
    'https://Example.com',
    'https://EXAMPLE.COM/',
    'https://x.se:443/',
    'https://x.se:99999/',
    'https://x.se:65536/',
    'https://x.se:0/',
    'https://x.se:08080/',
    'https://x.se:/',
    // IP literals in any form (#107 F1)
    'https://127.0.0.1',
    'https://127.0.0.1/x',
    'https://0x7f.1',
    'https://0x7f.0.0.1',
    'https://2130706433',
    'https://0177.0.0.1',
    'https://10.0.0.1:8080',
    'https://[::ffff:127.0.0.1]/',
    // Userinfo, including empty (#107 F1)
    'https://:@x.se',
    'https://@x.se',
    'https://u@x.se',
    // Bad labels
    'https://a..b.se',
    'https://-a.se',
    'https://a-.se',
    'https://a.-b.se',
    `https://example.com/${'a'.repeat(2048)}`,
    // mailto and tel abuse
    'mailto:',
    'mailto:not-an-email',
    'mailto:a@b.se?bcc=victim@example.com',
    'mailto:a@b.se?cc=x@y.se',
    'mailto:a@b.se?subject=x&to=y@z.se',
    'mailto:a@b.se,c@d.se',
    // Encoded CR/LF/NUL (#107 F2)
    'mailto:a@b.se?subject=x%0d%0aBcc:e@x.se',
    'mailto:a@b.se?subject=x%0D%0ABcc:e@x.se',
    'mailto:a@b.se?subject=x%0d',
    'mailto:a@b.se?subject=x%0A',
    'mailto:a@b.se?subject=x%00',
    'mailto:a@b.se?subject=x%1b',
    'mailto:a@b.se?subject=x%7F',
    'mailto:a@b.se?body=x%00',
    'mailto:a@b.se?subject=ok&body=x%00y',
    'mailto:a@b.se?body=x%1B',
    'mailto:javascript:alert(1)',
    'tel:',
    'tel:12',
    'tel:javascript:alert(1)',
    'tel:+46 8 123',
    'tel:+46812345678;ext=1',
  ],
};

export const assetRefFixtures: Fixtures = {
  valid: [
    'assets/hero.jpg',
    'assets/hero.jpeg',
    'assets/logo.png',
    'assets/team-2026.webp',
    'assets/photos/margherita_01.avif',
    'assets/fonts/display.woff2',
    'assets/a.b.c.png',
  ],
  invalid: [
    ...NOT_STRINGS,
    '',
    // Traversal
    '../assets/hero.jpg',
    'assets/../site.config.yaml',
    'assets/../../other-tenant/assets/hero.jpg',
    'assets/photos/../../x.jpg',
    'assets/..jpg',
    'assets/x..png',
    'assets/./hero.jpg',
    'assets/.hidden.jpg',
    './assets/hero.jpg',
    // URL-encoded traversal
    'assets/%2e%2e/x.jpg',
    'assets/%2E%2E/x.jpg',
    'assets/%2e%2e%2fx.jpg',
    'assets/..%2fx.jpg',
    'assets/%252e%252e/x.jpg',
    'assets%2f..%2fx.jpg',
    'assets/hero%00.jpg',
    'assets/hero.jpg%00.svg',
    // Absolute and URL forms
    '/assets/hero.jpg',
    '/etc/passwd',
    'C:/assets/hero.jpg',
    'c:\\assets\\hero.jpg',
    'file:///assets/hero.jpg',
    'https://example.com/hero.jpg',
    '//example.com/hero.jpg',
    '~/assets/hero.jpg',
    // Backslashes
    'assets\\hero.jpg',
    'assets\\..\\x.jpg',
    'assets/photos\\hero.jpg',
    // Wrong folder or shape
    'hero.jpg',
    'content/hero.jpg',
    'assets/',
    'assets/.jpg',
    'assets//hero.jpg',
    'assets/hero.jpg/',
    'assets/Hero.jpg',
    'assets/hero.JPG',
    'assets/hero bild.jpg',
    'assets/hjältebild.jpg',
    'assets/hero.jpg\n',
    'assets/hero\u202egpj.svg',
    // Disallowed extensions
    'assets/logo.svg',
    'assets/logo.svgz',
    'assets/logo.SVG',
    'assets/hero.jpg.svg',
    'assets/hero.gif',
    'assets/page.html',
    'assets/x.js',
    'assets/font.woff',
    'assets/font.ttf',
    'assets/hero',
    `assets/${'a'.repeat(200)}.jpg`,
  ],
};

export const priceSEKFixtures: Fixtures<readonly [number, number]> = {
  valid: [
    [0, 0],
    [129, 12900],
    [129.5, 12950],
    [129.95, 12995],
    [19.99, 1999],
    [0.07, 7],
    [0.29, 29],
    [100_000, 10_000_000],
  ],
  invalid: [
    ...NOT_STRINGS.filter((v) => typeof v !== 'number'),
    '129',
    '129 kr',
    '129,50',
    -1,
    -0.01,
    1.005,
    129.999,
    0.001,
    100_000.01,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ],
};

export const localeCodeFixtures: Fixtures = {
  valid: ['sv', 'en'],
  invalid: [...NOT_STRINGS, '', 'SV', 'sv-SE', 'en-GB', 'de', 'no', ' sv'],
};

/** For `localizedStringFor(['sv', 'en'])`. */
export const localizedStringSvEnFixtures: Fixtures = {
  valid: [
    { sv: 'Meny', en: 'Menu' },
    { sv: '  Meny ', en: 'Menu' },
  ],
  invalid: [
    ...NOT_STRINGS,
    'Meny',
    {},
    { sv: 'Meny' },
    { en: 'Menu' },
    { sv: 'Meny', en: '' },
    { sv: 'Meny', en: '   ' },
    { sv: 'Meny', en: 1 },
    { sv: 'Meny', en: 'Menu', de: 'Speisekarte' },
    { sv: 'Meny', en: 'Menu', __proto__x: 'x' },
    { sv: 'x'.repeat(2001), en: 'Menu' },
  ],
};

/** For `localizedStringFor(['sv'])`. */
export const localizedStringSvFixtures: Fixtures = {
  valid: [{ sv: 'Meny' }],
  invalid: [{}, { en: 'Menu' }, { sv: 'Meny', en: 'Menu' }],
};

/** For the context-free `LocalizedString`. */
export const localizedStringAnyFixtures: Fixtures = {
  valid: [{ sv: 'Meny' }, { en: 'Menu' }, { sv: 'Meny', en: 'Menu' }],
  invalid: [...NOT_STRINGS, {}, { de: 'Speisekarte' }, { sv: '' }, { sv: 'Meny', fr: 'Carte' }],
};

/** For `Weekday` (#144): lowercase English day names only. */
export const weekdayFixtures: Fixtures = {
  valid: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
  invalid: [
    ...NOT_STRINGS,
    '',
    'Monday',
    'MONDAY',
    'mon',
    'fri',
    'måndag',
    ' monday',
    'monday ',
    'weekend',
    0,
    7,
  ],
};

/** For `IsoDateTime` (#145): UTC `Z` only, whole seconds or exactly three fraction digits. */
export const isoDateTimeFixtures: Fixtures = {
  valid: [
    '2026-11-21T04:00:00Z',
    '2026-11-21T04:00:00.000Z',
    '2026-11-21T04:00:00.123Z',
    '2028-02-29T12:00:00Z',
    '2000-02-29T00:00:00Z',
    '2026-12-31T23:59:59.999Z',
    '2026-01-01T00:00:00Z',
  ],
  invalid: [
    ...NOT_STRINGS,
    '',
    '2026-11-21',
    '2026-11-21T04:00:00',
    '2026-11-21T04:00:00.000',
    '2026-11-21T04:00:00+01:00',
    '2026-11-21T04:00:00+00:00',
    '2026-11-21T04:00:00-00:00',
    '2026-11-21T04:00:00.000+01:00',
    '2026-11-21T04:00Z',
    '2026-11-21T04Z',
    '2026-11-21T04:00:00.1Z',
    '2026-11-21T04:00:00.12Z',
    '2026-11-21T04:00:00.1234Z',
    '2026-11-21T04:00:00.123456789Z',
    '2026-11-21T04:00:00.Z',
    '2026-11-21T04:00:00,123Z',
    '2026-02-29T00:00:00Z',
    '2026-02-30T00:00:00Z',
    '1900-02-29T00:00:00Z',
    '2026-04-31T00:00:00Z',
    '2026-13-01T00:00:00Z',
    '2026-00-10T00:00:00Z',
    '2026-11-00T00:00:00Z',
    '2026-11-21T24:00:00Z',
    '2026-11-21T23:60:00Z',
    '2026-12-31T23:59:60Z',
    '2026-11-21t04:00:00Z',
    '2026-11-21T04:00:00z',
    '2026-11-21 04:00:00Z',
    '+002026-11-21T04:00:00Z',
    '26-11-21T04:00:00Z',
    '20261121T040000Z',
    ' 2026-11-21T04:00:00Z',
    '2026-11-21T04:00:00Z ',
    '2026-11-21T04:00:00Z\n',
    `2026-11-21T04:00:00.${'1'.repeat(1000)}Z`,
  ],
};

/**
 * For `singleLineText` (#157): one value per character class the rule rejects, each with a
 * readable label. Every entry must give exactly one `invalid_format` issue, in the primitive and
 * in every field built on it (page title and description, location name, street, city).
 */
export const SINGLE_LINE_TEXT_UNSAFE: readonly (readonly [label: string, value: string])[] = [
  ['LF', 'a\nb'],
  ['CR LF', 'a\r\nb'],
  ['CR', 'a\rb'],
  ['TAB', 'a\tb'],
  ['vertical tab', 'a\u000bb'],
  ['form feed', 'a\u000cb'],
  ['NUL', 'a\u0000b'],
  ['ESC (terminal escape)', 'a\u001b[31mb'],
  ['DEL', 'a\u007fb'],
  ['NEL (U+0085)', 'a\u0085b'],
  ['C1 CSI (U+009B)', 'a\u009bb'],
  ['line separator U+2028', 'a b'],
  ['paragraph separator U+2029', 'a b'],
  ['LRE U+202A', 'a‪b'],
  ['RLE U+202B', 'a‫b'],
  ['PDF U+202C', 'a‬b'],
  ['LRO U+202D', 'a‭b'],
  ['RLO U+202E', 'a‮b'],
  ['LRI U+2066', 'a⁦b'],
  ['RLI U+2067', 'a⁧b'],
  ['FSI U+2068', 'a⁨b'],
  ['PDI U+2069', 'a⁩b'],
  ['LRM U+200E', 'a‎b'],
  ['RLM U+200F', 'a‏b'],
  ['ALM U+061C', 'a؜b'],
  ['zero-width space U+200B', 'a​b'],
  ['ZWNJ U+200C', 'a‌b'],
  ['ZWJ U+200D', 'a‍b'],
  ['word joiner U+2060', 'a⁠b'],
  ['BOM inside U+FEFF', 'a﻿b'],
  ['soft hyphen U+00AD', 'a­b'],
  ['lone high surrogate', 'a\ud800b'],
  ['lone low surrogate', 'a\udc00b'],
  ['zero-width space only', '​'],
  ['zero-width characters only', '​‌‍⁠'],
  ['bidi override only', '‮'],
  ['combining mark only', '́'],
];

/** For `singleLineText(20)`. */
export const singleLineTextFixtures: Fixtures = {
  valid: [
    'Om oss',
    'a',
    '1',
    '-',
    '🍕',
    'Pizza ❤️',
    'Café Ängelholm',
    'Smörgås & öl: 99 kr',
    'Åäö ÅÄÖ é ü ñ',
    '  Om oss  ',
    ' Om oss ',
    '﻿Om oss',
    'Om oss',
    'Rock’n’roll',
    'x'.repeat(20),
    ` ${'x'.repeat(20)} `,
  ],
  invalid: [
    ...NOT_STRINGS,
    '',
    ' ',
    ' ',
    '\n',
    'x'.repeat(21),
    ...SINGLE_LINE_TEXT_UNSAFE.map(([, value]) => value),
  ],
};
