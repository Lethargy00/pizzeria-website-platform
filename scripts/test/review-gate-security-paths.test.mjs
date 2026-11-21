// #128: the root pnpmfile runs code on every pnpm install, so it is a dependency change;
// the license gate is a security control, so changing it needs security review.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, DEPENDENCY_PATHS, MATRIX } from '../review-gate.mjs';

const missing = (files, labels = ['approved:peer']) =>
  evaluate(files, labels)
    .missing.map((m) => m.label)
    .sort();

const row = (id) => MATRIX.find((r) => r.id === id);

for (const f of ['.pnpmfile.cjs', '.pnpmfile.mjs']) {
  test(`security paths: ${f} is in DEPENDENCY_PATHS`, () => {
    assert.ok(DEPENDENCY_PATHS.includes(f), f);
  });

  test(`security paths: ${f} matches the dependency row`, () => {
    assert.equal(row('dependency').when(f, [], {}), true);
  });

  test(`security paths: ${f} with only peer review needs architect and security`, () => {
    assert.deepEqual(missing([f]), ['approved:architect', 'approved:security']);
  });

  test(`security paths: ${f} passes with peer, architect and security`, () => {
    assert.deepEqual(
      missing([f], ['approved:peer', 'approved:architect', 'approved:security']),
      [],
    );
  });
}

test('security paths: a pnpmfile outside the workspace root is not a dependency path', () => {
  // pnpm only loads the root pnpmfile (or one named in .npmrc / pnpm-workspace.yaml,
  // which are dependency paths already).
  assert.equal(row('dependency').when('packages/core/.pnpmfile.cjs', [], {}), false);
});

test('security paths: scripts/check-licenses.mjs matches the security row', () => {
  assert.equal(row('security').when('scripts/check-licenses.mjs', []), true);
});

test('security paths: scripts/check-licenses.mjs with only peer review needs security', () => {
  assert.deepEqual(missing(['scripts/check-licenses.mjs']), ['approved:security']);
});

test('security paths: scripts/check-licenses.mjs passes with peer and security', () => {
  assert.deepEqual(
    missing(['scripts/check-licenses.mjs'], ['approved:peer', 'approved:security']),
    [],
  );
});

test('security paths: the narrow pattern does not reach other check-*.mjs scripts', () => {
  // Orchestrator decision on #128: only check-licenses.mjs, not scripts/check-*.mjs.
  assert.equal(row('security').when('scripts/check-example.mjs', []), false);
});
