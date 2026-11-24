// #162: on a case-insensitive filesystem (macOS, Windows) `.PNPMFILE.cjs` is the file pnpm opens
// as `.pnpmfile.cjs`, so review-gate must ask for the same approvals on every case variant of a
// reviewed path (fail closed). glob.mjs keeps case-sensitive matching as its default, which
// touches-guard and the other callers rely on; review-gate opts in with { nocase: true }.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { globToRegExp, matchesAny, foldCase } from '../lib/glob.mjs';
import {
  evaluate,
  manifestProofs,
  DEPENDENCY_PATHS,
  RICHTEXT_PATHS,
  PACKAGE_MANIFESTS,
} from '../review-gate.mjs';
import { outside } from '../touches-guard.mjs';

const missing = (files, labels = ['approved:peer'], ctx) =>
  evaluate(files, labels, ctx)
    .missing.map((m) => m.label)
    .sort();
const DEP = ['approved:architect', 'approved:security'];

/** Every way to case a path that differs from the original: all upper, title case, flipped. */
const variants = (p) =>
  [
    p.toUpperCase(),
    p.replace(/(^|[/.-])([a-z])/g, (_, a, b) => a + b.toUpperCase()),
    [...p].map((c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase())).join(''),
  ].filter((v, i, all) => v !== p && all.indexOf(v) === i);

test('case: the issue reproduction now needs architect + security', () => {
  assert.deepEqual(missing(['.pnpmfile.cjs']), DEP);
  assert.deepEqual(missing(['.PNPMFILE.cjs']), DEP);
  assert.deepEqual(missing(['.NPMRC']), DEP);
});

test('case: every dependency path needs the dependency row in any case', () => {
  const exact = [
    'pnpm-lock.yaml',
    'package.json',
    'playground/package.json',
    'pnpm-workspace.yaml',
    '.npmrc',
    '.pnpmfile.cjs',
    '.pnpmfile.mjs',
    'package.yaml',
    'package.json5',
    'playground/package.yaml',
    'packages/ui/package.json5',
  ];
  for (const p of exact) {
    assert.ok(matchesAny(p, DEPENDENCY_PATHS), `${p} is a dependency path`);
    for (const v of variants(p))
      for (const need of DEP)
        assert.ok(missing([v]).includes(need), `${v} must need ${need} (variant of ${p})`);
  }
  for (const v of [
    'Package.json',
    'PNPM-workspace.yaml',
    'Pnpm-Lock.YAML',
    'PLAYGROUND/Package.JSON',
  ])
    assert.ok(missing([v]).includes('approved:security'), v);
});

test('case: a workspace manifest variant needs architect + security and is never proven', async () => {
  for (const p of [
    'packages/cli/Package.json',
    'Packages/cli/package.json',
    'PACKAGES/CLI/PACKAGE.JSON',
  ])
    assert.deepEqual(missing([p]), DEP, p);
  // A proof made for the exact path does not cover a variant of it.
  const ctx = { noDependencyChange: new Set(['packages/cli/package.json']) };
  assert.deepEqual(missing(['packages/cli/package.json'], ['approved:peer'], ctx), [
    'approved:architect',
  ]);
  assert.deepEqual(missing(['packages/cli/Package.json'], ['approved:peer'], ctx), DEP);
  // manifestProofs only proves exact-case manifests, so a variant is never put in the set.
  let calls = 0;
  const api = async () => {
    calls++;
    throw new Error('must not be called');
  };
  const r = await manifestProofs(
    'o/r',
    1,
    [{ filename: 'packages/cli/Package.json', status: 'modified', sha: 'a'.repeat(40) }],
    api,
  );
  assert.equal(r.noDependencyChange.size, 0);
  assert.equal(calls, 0);
  assert.ok(!matchesAny('packages/cli/Package.json', [PACKAGE_MANIFESTS]));
});

test('case: security paths need approved:security in any case', () => {
  const paths = [
    'scripts/review-gate.mjs',
    'scripts/touches-guard.mjs',
    'scripts/tenant-guard.mjs',
    'scripts/new-guard.mjs',
    'scripts/lib/glob.mjs',
    'scripts/check-licenses.mjs',
    '.github/workflows/ci.yml',
    '.github/CODEOWNERS',
    'packages/functions/src/contact.ts',
    'packages/adapters/src/email.ts',
    'packages/ui/src/components/ContactForm/index.astro',
    'packages/core/src/sanitize/index.ts',
    'packages/core/src/csp/policy.ts',
    'packages/core/src/headers/index.ts',
    'packages/cli/src/build/index.ts',
    'packages/cli/src/isolation/env.ts',
    'packages/adapters/email/.env.example',
    'SECURITY.md',
    'docs/SECURITY.md',
    'docs/THREAT-MODEL.md',
  ];
  for (const p of paths) {
    assert.ok(missing([p]).includes('approved:security'), `${p} needs security`);
    for (const v of variants(p))
      assert.ok(
        missing([v]).includes('approved:security'),
        `${v} must need security (variant of ${p})`,
      );
  }
});

test('case: richtext paths need approved:security in any case', () => {
  const paths = [
    'packages/core/src/richtext/render.ts',
    'packages/core/package.json',
    'scripts/boundaries.json',
    'scripts/check-boundaries.mjs',
    'scripts/check-html-sinks.mjs',
    'scripts/test/richtext-boundary.test.mjs',
    'scripts/test/check-html-sinks.test.mjs',
  ];
  for (const p of paths) {
    assert.ok(matchesAny(p, RICHTEXT_PATHS), `${p} is a richtext path`);
    for (const v of variants(p)) {
      assert.ok(matchesAny(v, RICHTEXT_PATHS, { nocase: true }), `${v} nocase`);
      // A proof for the exact manifest must not lift the richtext row on a variant either.
      const ctx = { noDependencyChange: new Set([v]) };
      assert.ok(missing([v], ['approved:peer'], ctx).includes('approved:security'), v);
    }
  }
});

test('case: architect and a11y-perf rows match case variants too', () => {
  for (const p of ['Packages/schema/src/index.ts', 'DOCS/ADR/0004-x.md', 'Scripts/Boundaries.JSON'])
    assert.ok(missing([p]).includes('approved:architect'), p);
  for (const p of ['Packages/UI/src/x.astro', 'PLAYGROUND/index.astro', 'packages/Tokens/a.css'])
    assert.ok(missing([p]).includes('approved:a11y-perf'), p);
});

test('case: letters that case-insensitive filesystems fold to ASCII are caught', () => {
  // dotless i (U+0131) and long s (U+017F) uppercase to I and S; Kelvin sign (U+212A) lowercases to k.
  assert.equal(foldCase('.pnpmfıle.cjs'), '.pnpmfile.cjs');
  assert.equal(foldCase('ſecurity.md'), 'security.md');
  assert.equal(foldCase('K'), 'k');
  assert.deepEqual(missing(['.pnpmfıle.cjs']), DEP);
  assert.ok(missing(['ſcripts/review-gate.mjs']).includes('approved:security'));
  assert.ok(missing(['scripts/lib/Keys.mjs']).includes('approved:security'));
  assert.ok(missing(['docs/ſECURITY.md']).includes('approved:security'));
});

test('case: unrelated paths still need only peer', () => {
  for (const p of [
    'README.md',
    'Docs/Guide.md',
    'tenants/demo/content/Menu.yaml',
    'scripts/sync.mjs',
  ])
    assert.deepEqual(missing([p]), [], p);
});

test('case: glob.mjs stays case-sensitive by default (touches-guard, tenant-guard)', () => {
  assert.ok(globToRegExp('.npmrc').test('.npmrc'));
  assert.ok(!globToRegExp('.npmrc').test('.NPMRC'));
  assert.equal(globToRegExp('.npmrc').flags, '');
  assert.ok(globToRegExp('.npmrc', { nocase: true }).test('.NPMRC'));
  assert.equal(globToRegExp('.npmrc', { nocase: true }).flags, 'i');
  assert.ok(!matchesAny('Package.json', ['package.json']));
  assert.ok(matchesAny('Package.json', ['package.json'], { nocase: true }));
  assert.ok(!matchesAny('.pnpmfıle.cjs', ['.pnpmfile.cjs']));
  assert.ok(matchesAny('.pnpmfıle.cjs', ['.pnpmfile.cjs'], { nocase: true }));
  // The glob is folded the same way as the path, so a non-ASCII glob matches its folded forms.
  assert.ok(matchesAny('docs/STRASSE.md', ['docs/straße.md'], { nocase: true }));
  assert.ok(globToRegExp('docs/straße.md', { nocase: true }).test(foldCase('docs/Straße.md')));
  // nocase changes case only: the glob structure is the same.
  assert.ok(
    !matchesAny('PACKAGES/UI/SUB/PACKAGE.JSON', ['packages/*/package.json'], { nocase: true }),
  );
  assert.ok(matchesAny('DOCS/HANDOFF.MD', ['docs/{SETUP,HANDOFF}.md'], { nocase: true }));
  assert.ok(!matchesAny('DOCS/OTHER.MD', ['docs/{SETUP,HANDOFF}.md'], { nocase: true }));
  // touches-guard keeps exact-case matching: a differently-cased file is outside the Touches.
  assert.deepEqual(outside(['Scripts/foo.mjs', 'scripts/foo.mjs'], ['scripts/**']), [
    'Scripts/foo.mjs',
  ]);
});
