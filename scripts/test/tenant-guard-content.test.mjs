// tenant-guard content rules (#132): raw HTML fails closed, entity-encoded and control-character-split
// script URLs are caught, unquoted event handlers are caught, and legitimate Markdown still passes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CONTENT_RULES, checkTenants, findRule, normalizeForScan } from '../tenant-guard.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'pwp-content-'));
const put = (root, rel, text) => {
  mkdirSync(join(root, rel, '..'), { recursive: true });
  writeFileSync(join(root, rel), text);
};
/** Rule ids that match `text` (the same check checkTenants runs per file). */
const hits = (text) => {
  const n = normalizeForScan(text);
  return CONTENT_RULES.filter((r) => findRule(r, text, n) !== -1).map((r) => r.id);
};
/** Problems for `text` as line 2 of a Markdown file and as a YAML value. */
const scan = (text) => {
  const r = tmp();
  put(r, 't/content/page.md', `# Rubrik\n${text}\n`);
  put(r, 't/content/data.yaml', `title: ok\nbody: ${JSON.stringify(text)}\n`);
  return checkTenants(r);
};

// Every payload from issue #132, plus the variants the fix names.
const ISSUE_PAYLOADS = {
  '<img src=x onerror=alert(1)>': ['html-tag', 'event-handler'],
  '&lt;img src=x onerror=alert(1)&gt;': ['event-handler'],
  '<svg/onload=alert(1)>': ['html-tag', 'html-embed', 'event-handler'],
  '[x](javascript&#58;alert(1))': ['js-url'],
  '<a href="jav&#x61;script:alert(1)">x</a>': ['html-tag', 'js-url'],
};

test('every payload from #132 is rejected, by the expected rules', () => {
  for (const [payload, rules] of Object.entries(ISSUE_PAYLOADS)) {
    const got = hits(payload);
    for (const id of rules) assert.ok(got.includes(id), `${payload}: ${id} not in ${got}`);
    const problems = scan(payload);
    assert.ok(
      problems.some((p) => p.path === 'tenants/t/content/page.md:2'),
      `${payload}: ${JSON.stringify(problems)}`,
    );
    assert.ok(
      problems.some((p) => p.path === 'tenants/t/content/data.yaml:2'),
      `${payload} (yaml): ${JSON.stringify(problems)}`,
    );
  }
});

test('html-tag: any raw tag, comment, declaration or processing instruction fails', () => {
  for (const s of [
    '<a href="https://example.com">x</a>',
    '<A HREF="https://example.com">x</A>',
    '<img src=x>',
    '<math><mi>x</mi></math>',
    '<details open>',
    '<div>',
    '</p>',
    '<br/>',
    '<!-- hidden -->',
    '<!DOCTYPE html>',
    '<![CDATA[x]]>',
    '<?xml version="1.0"?>',
    '`<b>bold in a code span</b>`', // fail closed, documented in the message
    '<https://example.com onmouseover=alert(1)>', // whitespace: not an autolink
    '<http://example.com>', // only https/mailto/tel autolinks are exempt
    '<javascript:alert(1)>',
    '<data:text/html,x>',
    '<svg/onload=x@y.z>', // "/" and "=" are not allowed in an exempt email local part
  ])
    assert.ok(hits(s).includes('html-tag'), s);
});

test('html-tag: autolinks with allowed schemes and plain email autolinks pass', () => {
  for (const s of [
    'Beställ på <https://example.com/order?x=1&y=2#top>.',
    '<HTTPS://EXAMPLE.COM>',
    'Mejla <mailto:hej@example.com> eller ring <tel:+46812345678>.',
    'Mejla <hej.pizza+bord@example.co.uk>.',
  ])
    assert.deepEqual(hits(s), [], s);
  const r = tmp();
  put(
    r,
    't/content/pages/kontakt.md',
    '# Kontakt\n\nSe <https://example.com/meny> eller mejla <hej@example.com>.\n',
  );
  assert.deepEqual(checkTenants(r), []);
});

test('html rules also see tags written with YAML double-quoted escapes', () => {
  const cases = {
    'body: "\\x3ciframe src=https://evil.example/x\\x3e"': ['html-tag', 'html-embed'],
    'body: "<meta http-equiv=refresh content=0;url=https://evil.example>"': [
      'html-tag',
      'html-embed',
    ],
    'body: "\\x3cform action=https://evil.example\\x3e…"': ['html-tag', 'html-embed'],
    'body: "\\u003cscript\\u003ealert(1)\\u003c/script\\u003e"': ['html-tag', 'html-script'],
    'body: "\\U0000003cb\\U0000003e"': ['html-tag'],
    'body: "\\X3Cdiv>"': ['html-tag'],
  };
  for (const [line, rules] of Object.entries(cases)) {
    const got = hits(line);
    for (const id of rules) assert.ok(got.includes(id), `${line}: ${id} not in ${got}`);
    const r = tmp();
    put(r, 't/content/data.yaml', `title: ok\n${line}\n`);
    const p = checkTenants(r);
    for (const id of rules)
      assert.ok(
        p.some((x) => x.rule === id && x.path === 'tenants/t/content/data.yaml:2'),
        `${line}: ${JSON.stringify(p)}`,
      );
  }
});

test('html rules: "&lt;" stays a literal "<", and an escaped backslash is not an escape', () => {
  for (const s of [
    'body: "&lt;b&gt; visas som text"',
    'Skriv &lt;div&gt; för att visa en tagg.',
    'body: "C:\\\\x3cdiv"', // YAML "\\" is a backslash, so "x3cdiv" stays text
  ])
    for (const id of ['html-tag', 'html-script', 'html-embed'])
      assert.ok(!hits(s).includes(id), `${s}: ${id}`);
});

test('html-tag: a "<" that cannot start a tag passes', () => {
  for (const s of ['Pris < 100 kr', '1 <2 och 3<4', 'Vi <3 pizza', 'a<-b', 'x <= y'])
    assert.deepEqual(hits(s), [], s);
});

test('event-handler: quoted, unquoted, slash and quote separated forms fail', () => {
  for (const s of [
    '<img src=x onerror="alert(1)">',
    "<img src=x onerror='alert(1)'>",
    '<img src=x onerror=alert(1)>',
    '<img src=x ONERROR = alert(1)>',
    '<svg/onload=alert(1)>',
    '<img src="x"onerror=alert(1)>',
    "<img src='x'onerror=alert(1)>",
    '<a href="x"onclick=1>',
    '<b onclick = x>',
    '<b x\tonclick=alert(1)>',
    '<b\nonclick=alert(1)>',
    '<img src=x&#32;onerror=alert(1)>', // entity-encoded separator
    '<img src=x&Tab;onerror=alert(1)>',
    '`&lt;img src=x onerror=1&gt;`', // a tag built by the entity-decoded view
    '&lt;img src=x onerror=alert(1)&gt;',
    '"\\x3cimg src=x onerror=1\\x3e"', // a tag built by YAML escapes
    `<img ${'x'.repeat(1900)} onerror=1>`, // long attribute run, inside the bound
  ])
    assert.ok(hits(s).includes('event-handler'), JSON.stringify(s));
});

test('event-handler: only matches inside a tag, so prose and URLs with "on…=" pass', () => {
  for (const s of [
    'Öppet onsdag till söndag.',
    'onsdag: 11-22',
    'Beställ online, hämta i butik.',
    'Pizza of the day: one',
    'Varje onsdag = pizzadag',
    'Onsdag = 2 för 1',
    'Margherita onsdag=89',
    'Du kan beställa online = enkelt',
    'Vi öppnar kl. 11 online=1',
    '"onsdagar = billigare"',
    '[Meny](https://example.com/online=1)',
    '/online=1',
    'Pris < 100 kr, onsdag = 89 kr', // a "<" that does not start a tag
  ]) {
    assert.deepEqual(hits(s), [], s);
    assert.deepEqual(scan(s), [], s); // as a Markdown line and as a YAML string
  }
  // A tag longer than the bound is not matched by event-handler, but it still fails html-tag.
  const long = `<img ${'x'.repeat(2100)} onerror=1>`;
  assert.ok(!hits(long).includes('event-handler'));
  assert.ok(hits(long).includes('html-tag'));
});

test('js-url: literal, entity-encoded and split scheme forms fail', () => {
  for (const s of [
    'cta: javascript:alert(1)',
    '[x](JaVaScRiPt:alert(1))',
    '[x](javascript&#58;alert(1))',
    '[x](javascript&#058;alert(1))',
    '[x](javascript&#x3a;alert(1))',
    '[x](javascript&#X3A;alert(1))',
    '[x](javascript&colon;alert(1))',
    '[x](javascript&COLON;alert(1))',
    '[x](javascript&#58alert(1))', // reference without ";"
    '[x](&#106;avascript:alert(1))',
    '[x](&#x6A;&#x61;&#x76;&#x61;script:alert(1))',
    '[x](jav&#x61;script:alert(1))',
    '[x](java&Tab;script:alert(1))',
    '[x](java&NewLine;script:alert(1))',
    '[x](java&#9;script:alert(1))',
    '[x](java&#10;script:alert(1))',
    '[x](java&#13;script:alert(1))',
    '[x](java\u0000script:alert(1))',
    '[x](java\u200bscript:alert(1))',
    '[x](java\u00adscript:alert(1))',
    '[x](\u0001javascript:alert(1))',
    '[x](javascript\t:alert(1))',
    '[x](javascript&amp;#58;alert(1))', // double encoded
    '[x](javascript&amp;colon;alert(1))',
    '[x](vbscript:msgbox(1))',
    '[x](vbscript&#58;msgbox(1))',
    '[x](data:text/html;base64,PHNjcmlwdD4=)',
    '[x](data&colon;text/html,x)',
    '[x](DATA:text/html,x)',
    '[x][r]\n\n[r]: javascript&#58;alert(1)', // reference-style definition
    // YAML double-quoted escapes, decoded by the YAML parser before the value reaches Markdown.
    'cta: "jav\\tascript:alert(1)"',
    'cta: "javascript\\x3aalert(1)"',
    'cta: "javascript\\u003aalert(1)"',
    'cta: "javascript\\U0000003aalert(1)"',
    'cta: "java\\\n  script:alert(1)"', // escaped line break joins the two halves
    // Markdown backslash-escaped punctuation in a link destination.
    '[x](javascript\\:alert(1))',
    '[x](javascript\\&#58;alert(1))',
  ])
    assert.ok(hits(s).includes('js-url'), JSON.stringify(s));
});

test('js-url: ordinary text and allowed schemes pass', () => {
  for (const s of [
    '[Beställ](https://example.com/order)',
    '[Mejla](mailto:hej@example.com) eller [ring](tel:+46812345678)',
    'Vi bakar med surdeg &amp; kärlek &#8211; sedan 1998.',
    'metadata och javascriptless sidor',
    'ajavascript:x', // the scheme is "ajavascript", not javascript
  ])
    assert.deepEqual(hits(s), [], s);
});

// #165: "data:" fails only when it is followed by the shape of a data URL.
test('js-url: data: URLs fail, literally, entity-encoded and in Markdown links', () => {
  for (const s of [
    'data:text/html,<b>x</b>',
    'data:text/html,%3Cscript%3E',
    'data:,x',
    'data:;base64,PHNjcmlwdD4=',
    '[x](data:image/svg+xml;base64,PHN2Zz4=)',
    '[x](data:text/html;charset=utf-8,x)',
    '[x](data:text/html; charset=utf-8,x)', // whitespace in the parameters
    '[x](data: text/html ,x)', // whitespace around the media type, stripped by browsers
    `[x](data:text/html;x=${'a'.repeat(5000)},x)`, // parameters of any length
    '[x](data:text/html;x=a:b,x)', // ":" in a parameter
    'cta: "data:text/html,x"',
    // Entity-encoded scheme, separator or parameters.
    '[x](data&#58;text/html,x)',
    '[x](data&colon;,x)',
    '[x](data:&comma;x)',
    '[x](data:&#44;x)',
    '[x](data:&semi;base64,PHNjcmlwdD4=)',
    '[x](data&colon;image/svg&plus;xml&semi;base64&comma;PHN2Zz4=)',
    '[x](data&#x3a;image/svg&#43;xml&#59;base64&#44;PHN2Zz4=)',
    '[x](&#100;ata:,x)',
    '[x](da&Tab;ta:,x)',
    '[x](da​ta:text/html,x)',
    '[x](data\\:text/html,x)', // Markdown backslash escape
    '[x](data&amp;#58;,x)', // double encoded
    'cta: "data\\x3a,x"', // YAML escape
    '[x][r]\n\n[r]: data:text/html,x', // reference-style definition
  ]) {
    assert.ok(hits(s).includes('js-url'), JSON.stringify(s));
    const problems = scan(s).filter((p) => p.rule === 'js-url');
    assert.ok(problems.length >= 2, `${JSON.stringify(s)}: ${JSON.stringify(problems)}`);
  }
});

// #180: the separators may be percent-encoded.
test('js-url: data: URLs with percent-encoded separators fail', () => {
  for (const s of [
    'data:text%2Fhtml,x',
    'DATA:text%2fhtml;base64,x',
    '[x](data:text%2Fhtml,x)',
    '[x](data:image%2Fsvg+xml;base64,PHN2Zz4=)',
    '[x](data: text%2Fhtml ,x)',
    '[x](data:text%2Fhtml%3Bbase64,PHNjcmlwdD4=)', // "%3B" as the parameter separator
    '[x](data:text%2Fhtml%2Cx)', // "%2C" as the data separator
    '[x](data:text/html%2cx)',
    '[x](data:%2Cx)',
    '[x](data:%3bbase64,PHNjcmlwdD4=)',
    // Entity-encoded "%" or "/".
    '[x](data:text&#37;2Fhtml,x)',
    '[x](data:text&percnt;2fhtml,x)',
    '[x](data&colon;text&#x25;2Fhtml&comma;x)',
    'cta: "data:text\\x252Fhtml,x"', // YAML escape
  ]) {
    assert.ok(hits(s).includes('js-url'), JSON.stringify(s));
  }
});

test('js-url: prose with "data:" and a percent sign passes', () => {
  for (const s of [
    'Uppdaterad data: 2026',
    'Data: 20% rabatt, varje dag',
    'data: 50%',
    'Vi sparar data: 100%2 gånger',
  ]) {
    assert.deepEqual(hits(s), [], JSON.stringify(s));
    assert.deepEqual(scan(s), [], JSON.stringify(s));
  }
});

test('js-url: a long percent-encoded media type is scanned in reasonable time', () => {
  for (const big of [
    `data:a%2f${'a%2f'.repeat(100_000)}`,
    `data:${'a%2f'.repeat(100_000)}`,
    `data:a%2fa `.repeat(30_000),
    `data:${'%'.repeat(100_000)}`,
  ]) {
    const start = Date.now();
    assert.ok(!hits(big).includes('js-url'));
    assert.ok(Date.now() - start < 3000, `took ${Date.now() - start} ms`);
  }
});

test('js-url: the word "data:" in prose and a YAML key named data pass', () => {
  for (const s of [
    'Uppdaterad data: 2026',
    'Dina data: namn, adress och telefonnummer.',
    'Vi sparar följande data: e-post; telefon.',
    'Senaste data:\n\n- 2026-01-01',
    'metadata: x',
    'data: 2026-11-21',
    'Our data: name, address',
  ]) {
    assert.deepEqual(hits(s), [], JSON.stringify(s));
    assert.deepEqual(scan(s), [], JSON.stringify(s)); // as a Markdown line and as a YAML string
  }
  const r = tmp();
  put(r, 't/content/menu.yaml', 'data:\n  title: Meny\n  items:\n    - name: Margherita\n');
  put(
    r,
    't/content/list.yaml',
    'sections:\n  - type: hours\n    data: {open: "11", close: "22"}\n',
  );
  assert.deepEqual(checkTenants(r), []);
});

test('js-url: javascript: and vbscript: still fail closed, also in prose', () => {
  for (const s of ['Vi använder inte javascript: bara HTML', 'vbscript: nej'])
    assert.ok(hits(s).includes('js-url'), s);
});

test('js-url: a long run of "data:" with whitespace is scanned in reasonable time', () => {
  const big = `data:${' '.repeat(50)}`.repeat(18_000);
  const start = Date.now();
  assert.ok(!hits(big).includes('js-url'));
  assert.ok(Date.now() - start < 3000, `took ${Date.now() - start} ms`);
});

test('a decoded match is reported on the line of its source text', () => {
  const r = tmp();
  put(r, 't/content/x.md', 'rad 1\nrad 2\n[x](jav&#x61;script&colon;alert(1))\n');
  const p = checkTenants(r).filter((x) => x.rule === 'js-url');
  assert.deepEqual(
    p.map((x) => x.path),
    ['tenants/t/content/x.md:3'],
  );
  assert.match(p[0].message, /Found: "\[x\]\(jav&#x61;script&colon;alert\(1\)\)"/);
});

test('normalizeForScan decodes references and maps back to source indexes', () => {
  const src = 'a&#58;b&colon;c&amp;#58;d\te&#x200b;f&unknown;';
  const { yaml, decoded, stripped: n } = normalizeForScan(src);
  assert.equal(yaml.text, src); // no YAML escapes in src: entities stay as written
  const y = normalizeForScan('a\\x3cb\\\\x3c &lt; \\\n   c');
  assert.equal(y.yaml.text, 'a<b\\x3c &lt; c');
  assert.equal(y.yaml.map.length, y.yaml.text.length);
  assert.equal(y.yaml.map[y.yaml.text.lastIndexOf('c')], 'a\\x3cb\\\\x3c &lt; \\\n   c'.length - 1);
  assert.equal(decoded.text, 'a:b:c:d\te\u200bf&unknown;');
  assert.equal(n.text, 'a:b:c:def&unknown;');
  assert.equal(n.map.length, n.text.length);
  assert.equal(decoded.map.length, decoded.text.length);
  assert.equal(src[n.map[n.text.indexOf('b')]], 'b');
  assert.equal(src[n.map[n.text.indexOf('f')]], 'f');
  assert.equal(n.map[1], 1); // ":" from "&#58;" maps to its "&"
  assert.equal(
    normalizeForScan('x\\:y \\u003a \\x3A \\U0001F355').stripped.text,
    'x:y : : \u{1f355}',
  );
  // Out-of-range and zero code points become U+FFFD instead of throwing.
  assert.equal(
    normalizeForScan('&#0;&#x110000;&#99999999999999999999;').stripped.text,
    '\ufffd\ufffd\ufffd',
  );
});

test('a large text file is scanned in reasonable time', () => {
  const big = '&#58;<https://example.com/x> '.repeat(30_000);
  const start = Date.now();
  hits(big);
  assert.ok(Date.now() - start < 3000, `took ${Date.now() - start} ms`);
});
