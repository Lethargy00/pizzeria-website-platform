// #81, ADR 0002 Enforcement (c): any change to the rich-text chokepoint or to the checks
// that guard it needs approved:security. Also checks that CODEOWNERS mirrors the row and
// covers the workflows and gate scripts (#94).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ALT_MANIFESTS,
  DEPENDENCY_PATHS,
  evaluate,
  MATRIX,
  PACKAGE_MANIFESTS,
  RICHTEXT_PATHS,
} from '../review-gate.mjs';
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

// --- every dependency path and security-row glob has a CODEOWNERS security note (#160, #175) --
// The globs come from the constants review-gate.mjs exports (never parsed as text), so a new
// entry, a spread of another constant or a wider PACKAGE_MANIFESTS glob is checked at once.
const securityRow = MATRIX.find((r) => r.id === 'security');
// The security row keeps its globs inside the `when` closure and review-gate.mjs does not
// export them, so read them from the function's source (single, double or backtick quotes).
// The "import" test below checks that every recovered glob really triggers the row.
// Follow-up: export the list from review-gate.mjs and import it here.
const rowGlobs = [...securityRow.when.toString().matchAll(/(['"`])((?:(?!\1).)+)\1/g)]
  .map((m) => m[2])
  .filter((g) => g !== 'security:sensitive');

const expandBraces = (glob) => {
  const braces = /\{([^}]+)\}/.exec(glob);
  return braces ? braces[1].split(',').map((x) => glob.replace(braces[0], x)) : [glob];
};
/** A concrete path that the glob matches: `**` becomes two segments, `*` one name. */
const sampleOf = (glob) => glob.replaceAll('**', 'x/y').replaceAll('*', 'x');

test('CODEOWNERS: every owner everywhere is exactly @Lethargy00', () => {
  assert.ok(entries.length > 30, `parsed ${entries.length} entries`);
  for (const e of entries) assert.deepEqual(e.owners, ['@Lethargy00'], `entry "${e.re}"`);
});

test('review-gate constants were imported and recovered', () => {
  assert.ok(ALT_MANIFESTS.length >= 3, JSON.stringify(ALT_MANIFESTS));
  assert.ok(DEPENDENCY_PATHS.length >= 7, JSON.stringify(DEPENDENCY_PATHS));
  assert.equal(typeof PACKAGE_MANIFESTS, 'string');
  assert.ok(rowGlobs.length >= 20, `recovered ${rowGlobs.length} security-row globs`);
  // Each recovered glob really is a security-row glob: its sample path triggers the row.
  for (const g of rowGlobs)
    for (const g2 of expandBraces(g))
      assert.ok(securityRow.when(sampleOf(g2), []), `${g} → ${sampleOf(g2)} not in the row`);
  // A spread keeps ALT_MANIFESTS inside DEPENDENCY_PATHS.
  for (const g of ALT_MANIFESTS) assert.ok(DEPENDENCY_PATHS.includes(g), g);
});

const allGlobs = [
  ...new Set([...DEPENDENCY_PATHS, ...ALT_MANIFESTS, PACKAGE_MANIFESTS, ...rowGlobs]),
];
for (const g of allGlobs.flatMap(expandBraces)) {
  test(`CODEOWNERS: ${g} is owned with a security note`, () => {
    const path = sampleOf(g);
    const e = ownerOf(path);
    assert.ok(e, `no CODEOWNERS entry matches ${path}`);
    assert.deepEqual(e.owners, ['@Lethargy00'], `${path} owners`);
    assert.match(e.note, /\bsecurity\b/, `${path} resolves to "#${e.note}"`);
  });
}
