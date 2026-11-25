// #192: tenant-guard FORBIDDEN_NAMES must cover every file name that review-gate treats as a
// dependency file, so the two lists cannot drift apart silently.
// #210: and every Unicode compatibility look-alike of those names (NFKC plus case folding), with
// ignorable code points and trailing dots or spaces dropped. Fixtures use escaped code points only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FORBIDDEN_NAMES, checkTenants, isForbiddenName, nameKey } from '../tenant-guard.mjs';
import { DEPENDENCY_PATHS } from '../review-gate.mjs';

/** Expands `{a,b}` groups in a glob segment; any other glob syntax is returned unexpanded. */
const expandBraces = (s) => {
  const m = /\{([^{}]*)\}/.exec(s);
  if (!m) return [s];
  return m[1]
    .split(',')
    .flatMap((alt) => expandBraces(s.slice(0, m.index) + alt + s.slice(m.index + m[0].length)));
};

/** The literal file names that DEPENDENCY_PATHS names (the last path segment of each entry). */
const dependencyBasenames = () => [
  ...new Set(DEPENDENCY_PATHS.flatMap((p) => expandBraces(p.split('/').at(-1)))),
];

test('every DEPENDENCY_PATHS basename is a literal file name', () => {
  // A wildcard in the last segment cannot be checked name by name below; fail so the drift test
  // is extended instead of silently skipping it.
  for (const name of dependencyBasenames())
    assert.doesNotMatch(name, /[*?[\]{}]/, `cannot check "${name}" against FORBIDDEN_NAMES`);
});

test('FORBIDDEN_NAMES covers every DEPENDENCY_PATHS basename, in any case', () => {
  const names = dependencyBasenames();
  for (const n of ['package.json', '.pnpmfile.mjs', 'package.yaml', 'package.json5'])
    assert.ok(names.includes(n), `expected DEPENDENCY_PATHS to name ${n}`);
  const missing = names
    .flatMap((n) => [n, n.toUpperCase()])
    .filter((n) => !FORBIDDEN_NAMES.some((re) => re.test(n)));
  assert.deepEqual(
    missing,
    [],
    `review-gate DEPENDENCY_PATHS names files that tenant-guard FORBIDDEN_NAMES does not forbid: ${missing.join(', ')}. Add them to FORBIDDEN_NAMES in scripts/tenant-guard.mjs.`,
  );
});

test('checkTenants rejects each dependency file inside a tenant folder', () => {
  const root = mkdtempSync(join(tmpdir(), 'pwp-names-'));
  const names = dependencyBasenames();
  for (const n of names) {
    mkdirSync(join(root, 't', 'content'), { recursive: true });
    writeFileSync(join(root, 't', 'content', n), '{}\n');
    writeFileSync(join(root, 't', n), '{}\n');
  }
  const got = new Set(
    checkTenants(root)
      .filter((p) => p.rule === 'forbidden-file')
      .map((p) => p.path),
  );
  for (const n of names) {
    assert.ok(got.has(`tenants/t/${n}`), `tenants/t/${n} not rejected`);
    assert.ok(got.has(`tenants/t/content/${n}`), `tenants/t/content/${n} not rejected`);
  }
});

test('the drift check fails when a dependency name is missing from FORBIDDEN_NAMES', () => {
  // Bad fixture: drop the #192 additions and the check must report them.
  const old = FORBIDDEN_NAMES.filter(
    (re) => !['.pnpmfile.mjs', 'package.yaml', 'package.json5'].some((n) => re.test(n)),
  );
  const missing = dependencyBasenames().filter((n) => !old.some((re) => re.test(n)));
  assert.deepEqual(missing.sort(), ['.pnpmfile.mjs', 'package.json5', 'package.yaml']);
});

// ---- #210: Unicode look-alikes ----

const KELVIN = '\u212a'; // KELVIN SIGN: NFKC and case folding give "k"
const LONG_S = '\u017f'; // LATIN SMALL LETTER LONG S: NFKC gives "s"
const ZWSP = '\u200b'; // ZERO WIDTH SPACE
const ZWJ = '\u200d'; // ZERO WIDTH JOINER
const BOM = '\ufeff'; // ZERO WIDTH NO-BREAK SPACE
const VS16 = '\ufe0f'; // VARIATION SELECTOR-16
const NON_ASCII = /[^\x20-\x7e]/;

/** Fullwidth form of every printable ASCII character (U+FF01..U+FF5E), which NFKC maps back. */
const fullwidth = (s) =>
  [...s]
    .map((c) => {
      const cp = c.codePointAt(0);
      return cp > 0x20 && cp < 0x7f ? String.fromCodePoint(cp + 0xfee0) : c;
    })
    .join('');

/** Look-alike spellings of `name` that must still be refused. */
const lookalikes = (name) => {
  const out = [
    fullwidth(name),
    fullwidth(name.toUpperCase()),
    `${name}.`,
    `${name} `,
    `${name}. .`,
    `${ZWSP}${name}`,
    `${name}${BOM}`,
    `${name.slice(0, 2)}${ZWJ}${name.slice(2)}`,
    `${name.slice(0, 1)}${VS16}${name.slice(1)}`,
    `${name.slice(0, 1)}\u0007${name.slice(1)}`,
  ];
  if (/k/i.test(name)) out.push(name.replace(/k/gi, KELVIN));
  if (/s/i.test(name)) out.push(name.replace(/s/gi, LONG_S));
  if (/st/.test(name)) out.push(name.replace(/st/g, '\ufb06')); // LATIN SMALL LIGATURE ST
  if (/i/.test(name)) out.push(name.replace(/i/g, '\u0131')); // DOTLESS I, uppercases to "I"
  return out;
};

/** The #192 check: the raw name against the patterns, without `u` or normalisation. */
const caughtBefore210 = (n) => FORBIDDEN_NAMES.some((re) => new RegExp(re.source, 'i').test(n));

test('the issue fixtures: Kelvin sign and long s spellings are forbidden', () => {
  for (const n of [
    `pac${KELVIN}age.yaml`,
    `pnpm-loc${KELVIN}.yaml`,
    `pac${KELVIN}age.json`,
    `.pnpmfile.cj${LONG_S}`,
    `.pnpmfile.mj${LONG_S}`,
    `npm-${LONG_S}hrinkwrap.json`,
    `pnpm-work${LONG_S}pace.yaml`,
    `node_module${LONG_S}`,
    `Doc${KELVIN}erfile`,
  ]) {
    assert.ok(isForbiddenName(n), `${JSON.stringify(n)} (key ${JSON.stringify(nameKey(n))})`);
    // Bad fixture: each of these got past the check as it was before #210.
    assert.equal(caughtBefore210(n), false, `${JSON.stringify(n)} was already caught`);
  }
});

test('every DEPENDENCY_PATHS basename is refused in each look-alike form', () => {
  const missed = [];
  for (const name of dependencyBasenames()) {
    const forms = lookalikes(name);
    // Each basename is checked in at least one non-ASCII compatibility form.
    assert.ok(
      forms.some((l) => NON_ASCII.test(l) && l.normalize('NFKC') !== l),
      name,
    );
    for (const l of forms) if (!isForbiddenName(l)) missed.push(JSON.stringify(l));
  }
  assert.deepEqual(
    missed,
    [],
    'nameKey in scripts/tenant-guard.mjs must fold these to a FORBIDDEN_NAMES entry',
  );
});

test('the other FORBIDDEN_NAMES entries are refused in look-alike forms too', () => {
  for (const name of [
    'Makefile',
    'Dockerfile',
    'deno.json',
    'deno.jsonc',
    'import-map.json',
    'importmap.json',
    'bun.lock',
    'bun.lockb',
    '.yarnrc',
    'node_modules',
  ]) {
    assert.ok(isForbiddenName(name), name);
    for (const l of lookalikes(name)) assert.ok(isForbiddenName(l), JSON.stringify(l));
  }
});

test('nameKey: NFKC, case folding, ignorables and trailing dots or spaces', () => {
  assert.equal(nameKey(`Pac${KELVIN}age.JSON`), 'package.json');
  assert.equal(nameKey(`.pnpmfile.cj${LONG_S}`), '.pnpmfile.cjs');
  assert.equal(nameKey(fullwidth('.NPMRC')), '.npmrc');
  assert.equal(nameKey(`node_modules${ZWSP}. `), 'node_modules');
  assert.equal(nameKey('a.....b'), 'a.....b');
});

test('ordinary content names, also non-ASCII ones, are not forbidden', () => {
  for (const n of [
    'menu.yaml',
    'sm\u00f6rg\u00e5sar.md', // NFC
    'smo\u0308rga\u030asar.md', // NFD
    'k\u00f6k.yaml',
    'pizza-\u0161pinat.md',
    'package-info.md',
    'packages.yaml',
    'node_modules.md',
    'my-package.json.md',
    'p\u0430ckage.json', // CYRILLIC SMALL A: a confusable, not a filesystem alias (documented)
  ])
    assert.equal(isForbiddenName(n), false, JSON.stringify(n));
});

test('nameKey stays fast on long hostile names', () => {
  const n = 200_000;
  for (const name of [
    `${'.'.repeat(n)}x`,
    `${' .'.repeat(n / 2)}x`,
    ZWSP.repeat(n),
    KELVIN.repeat(n),
    '\ufdfa'.repeat(n / 20), // ARABIC LIGATURE SALLALLAHOU...: NFKC expands it to 18 code points
  ]) {
    const start = Date.now();
    isForbiddenName(name);
    assert.ok(Date.now() - start < 2000, `${JSON.stringify(name.slice(0, 4))}... took too long`);
  }
});

test('checkTenants rejects look-alike dependency files and folders in a tenant', () => {
  const root = mkdtempSync(join(tmpdir(), 'pwp-lookalike-'));
  const files = [
    `pac${KELVIN}age.yaml`,
    `pnpm-loc${KELVIN}.yaml`,
    `pnpm-work${LONG_S}pace.yaml`,
    fullwidth('package.yaml'),
    `pnpm-lock${ZWSP}.yaml`,
  ];
  const dirs = [`node_module${LONG_S}`, 'node_modules.', `node${ZWJ}_modules`];
  mkdirSync(join(root, 't', 'content'), { recursive: true });
  writeFileSync(join(root, 't', 'content', 'menu.yaml'), 'title: Meny\n');
  for (const n of files) {
    writeFileSync(join(root, 't', n), 'a: 1\n');
    writeFileSync(join(root, 't', 'content', n), 'a: 1\n');
  }
  for (const d of dirs) mkdirSync(join(root, 't', 'content', d));
  const problems = checkTenants(root);
  const forbidden = new Set(problems.filter((p) => p.rule === 'forbidden-file').map((p) => p.path));
  // safe() leaves these printable code points unescaped, so the reported path is the name.
  for (const n of files) {
    assert.ok(forbidden.has(`tenants/t/${n}`), `tenants/t/${JSON.stringify(n)} not rejected`);
    assert.ok(forbidden.has(`tenants/t/content/${n}`), `content/${JSON.stringify(n)} not rejected`);
  }
  for (const d of dirs)
    assert.ok(forbidden.has(`tenants/t/content/${d}`), `folder ${JSON.stringify(d)} not rejected`);
  assert.deepEqual(
    problems.filter((p) => p.path.startsWith('tenants/t/content/menu.yaml')),
    [],
    'an ordinary file is still accepted',
  );
});

test('the forbidden-file message names the spelling the look-alike reads as', () => {
  const root = mkdtempSync(join(tmpdir(), 'pwp-lookalike-msg-'));
  mkdirSync(join(root, 't', 'content'), { recursive: true });
  writeFileSync(join(root, 't', 'content', `pac${KELVIN}age.yaml`), 'a: 1\n');
  writeFileSync(join(root, 't', 'content', 'package.yaml'), 'a: 1\n');
  const msgs = checkTenants(root)
    .filter((p) => p.rule === 'forbidden-file')
    .map((p) => p.message)
    .sort();
  assert.equal(msgs.length, 2);
  assert.match(msgs[0], /^"package\.yaml" is not allowed\./);
  assert.ok(msgs[1].startsWith(`"pac${KELVIN}age.yaml" (read as "package.yaml") is not allowed.`));
});
