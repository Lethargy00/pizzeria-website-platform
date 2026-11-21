// #81, ADR 0002 Enforcement (c): any change to the rich-text chokepoint or to the checks
// that guard it needs approved:security. Also checks that CODEOWNERS mirrors the row and
// covers the workflows and gate scripts (#94).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluate, MATRIX, RICHTEXT_PATHS } from '../review-gate.mjs';
import { globToRegExp } from '../lib/glob.mjs';

const missing = (files, labels) =>
  evaluate(files, labels)
    .missing.map((m) => m.label)
    .sort();

// [files, labels, missing approvals]
const cases = [
  // The chokepoint itself: renderMarkdown, the sanitize schema, the SafeHtml constructor.
  [['packages/core/src/richtext/index.ts'], ['approved:peer'], ['approved:security']],
  [['packages/core/src/richtext/schema.ts'], ['approved:peer'], ['approved:security']],
  [['packages/core/src/richtext/pipeline/transforms.ts'], ['approved:peer'], ['approved:security']],
  [['packages/core/src/richtext/render.test.ts'], ['approved:peer'], ['approved:security']],
  [['packages/core/src/richtext/index.ts'], ['approved:peer', 'approved:security'], []],
  // The ./richtext export lives in packages/core/package.json (also a dependency-row path).
  [['packages/core/package.json'], ['approved:peer'], ['approved:architect', 'approved:security']],
  [['packages/core/package.json'], ['approved:peer', 'approved:architect'], ['approved:security']],
  // The boundary rule (#79) and the HTML-sink check (#80), and their fixtures.
  [['scripts/boundaries.json'], ['approved:peer'], ['approved:architect', 'approved:security']],
  [['scripts/check-boundaries.mjs'], ['approved:peer'], ['approved:security']],
  [['scripts/check-html-sinks.mjs'], ['approved:peer'], ['approved:security']],
  [['scripts/test/richtext-boundary.test.mjs'], ['approved:peer'], ['approved:security']],
  [['scripts/test/check-html-sinks.test.mjs'], ['approved:peer'], ['approved:security']],
  [['scripts/test/html-sinks.test.mjs'], ['approved:peer'], ['approved:security']],
  // A rename out of the folder still lists the old path (changedPaths), so it still matches.
  [
    ['packages/core/src/text/index.ts', 'packages/core/src/richtext/index.ts'],
    ['approved:peer'],
    ['approved:security'],
  ],
  // Near misses: the rest of @pwp/core and other packages' richtext-like names stay peer-only.
  [['packages/core/src/index.ts'], ['approved:peer'], []],
  [['packages/core/src/holidays/se.ts'], ['approved:peer'], []],
  [['packages/core/src/richtextual/x.ts'], ['approved:peer'], []],
  [['packages/core/src/richtext.md'], ['approved:peer'], []],
  [['packages/core/README.md'], ['approved:peer'], []],
  [['scripts/test/guards.test.mjs'], ['approved:peer'], []],
  [['scripts/check-licenses.mjs'], ['approved:peer'], ['approved:security']], // #128
];

for (const [files, labels, want] of cases) {
  test(`review-gate richtext: ${files.join('+')} with [${labels.join(', ')}] → missing [${want.join(', ')}]`, () => {
    assert.deepEqual(missing(files, labels), want);
  });
}

test('review-gate richtext: the row requires approved:security and names ADR 0002 (c)', () => {
  const row = MATRIX.find((r) => r.id === 'richtext');
  assert.ok(row, 'MATRIX has a richtext row');
  assert.equal(row.approval, 'approved:security');
  const r = evaluate(['packages/core/src/richtext/index.ts'], []);
  assert.match(r.required.get('approved:security').join('\n'), /ADR 0002 \(c\)/);
});

test('review-gate richtext: every path is matched by its own row, independent of other rows', () => {
  const row = MATRIX.find((r) => r.id === 'richtext');
  const samples = {
    'packages/core/src/richtext/**': 'packages/core/src/richtext/a/b.ts',
    'packages/core/package.json': 'packages/core/package.json',
    'scripts/boundaries.json': 'scripts/boundaries.json',
    'scripts/check-boundaries.mjs': 'scripts/check-boundaries.mjs',
    'scripts/check-html-sinks.mjs': 'scripts/check-html-sinks.mjs',
    'scripts/test/richtext-*': 'scripts/test/richtext-boundary.test.mjs',
    'scripts/test/*html-sink*': 'scripts/test/check-html-sinks.test.mjs',
  };
  assert.deepEqual(Object.keys(samples).sort(), [...RICHTEXT_PATHS].sort());
  for (const [glob, path] of Object.entries(samples)) assert.ok(row.when(path, []), glob);
});

// --- CODEOWNERS mirrors the row (#81) and covers the gates (#94) ---------------------------

const CODEOWNERS = readFileSync(new URL('../../.github/CODEOWNERS', import.meta.url), 'utf8');
const entries = CODEOWNERS.split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'))
  .map((l) => {
    const [pattern, ...rest] = l.split(/\s+/);
    const hash = l.indexOf('#');
    return {
      re: globToRegExp(pattern),
      owners: rest.filter((t) => t.startsWith('@')),
      note: hash === -1 ? '' : l.slice(hash + 1),
    };
  });
/** CODEOWNERS semantics: the last matching pattern wins. */
const ownerOf = (path) => entries.findLast((e) => e.re.test(path));

const mustBeSecurityReviewed = [
  'packages/core/src/richtext/index.ts',
  'packages/core/src/richtext/schema.ts',
  'packages/core/package.json',
  'scripts/boundaries.json',
  'scripts/check-boundaries.mjs',
  'scripts/check-html-sinks.mjs',
  'scripts/test/richtext-boundary.test.mjs',
  'scripts/test/check-html-sinks.test.mjs',
  '.github/workflows/ci.yml',
  '.github/workflows/pr-gates.yml',
  '.github/workflows/security.yml',
  '.github/CODEOWNERS',
  'scripts/review-gate.mjs',
  'scripts/touches-guard.mjs',
  'scripts/tenant-guard.mjs',
  'scripts/lib/glob.mjs',
  'scripts/lib/fs-walk.mjs',
  // #128: install-time hooks and the license gate
  '.pnpmfile.cjs',
  '.pnpmfile.mjs',
  'scripts/check-licenses.mjs',
];

for (const path of mustBeSecurityReviewed) {
  test(`CODEOWNERS: ${path} is owned with security review`, () => {
    const e = ownerOf(path);
    assert.ok(e, `no CODEOWNERS entry matches ${path}`);
    assert.ok(e.owners.length > 0, `${path} has no owner`);
    assert.match(e.note, /\bsecurity\b/, `${path} resolves to "#${e.note}"`);
  });
}

test('CODEOWNERS: the rest of @pwp/core and ordinary scripts are not marked for security', () => {
  assert.doesNotMatch(ownerOf('packages/core/src/index.ts').note, /security/);
  assert.doesNotMatch(ownerOf('scripts/typecheck.mjs').note, /security/);
});

// --- every ALT_MANIFESTS glob has a CODEOWNERS line with a security note (#160) ---------------
// review-gate.mjs treats ALT_MANIFESTS as dependency paths (which need approved:security), so
// CODEOWNERS must say so. The list is read from the source text so it cannot drift.
const gateSrc = readFileSync(new URL('../review-gate.mjs', import.meta.url), 'utf8');
const altBlock = /export const ALT_MANIFESTS = \[([\s\S]*?)\];/.exec(gateSrc);
const altGlobs = altBlock ? [...altBlock[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : [];

test('ALT_MANIFESTS was parsed from review-gate.mjs', () => {
  assert.ok(altGlobs.length >= 3, `parsed ${JSON.stringify(altGlobs)}`);
});

for (const glob of altGlobs) {
  const braces = /\{([^}]+)\}/.exec(glob);
  const expanded = braces ? braces[1].split(',').map((x) => glob.replace(braces[0], x)) : [glob];
  for (const g of expanded) {
    test(`CODEOWNERS: ALT_MANIFESTS ${g} is owned with security review`, () => {
      const e = ownerOf(g.replaceAll('*', 'x'));
      assert.ok(e, `no CODEOWNERS entry matches ${g}`);
      assert.ok(e.owners.length > 0, `${g} has no owner`);
      assert.match(e.note, /\bsecurity\b/, `${g} resolves to "#${e.note}"`);
    });
  }
}
