// #192: tenant-guard FORBIDDEN_NAMES must cover every file name that review-gate treats as a
// dependency file, so the two lists cannot drift apart silently.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FORBIDDEN_NAMES, checkTenants } from '../tenant-guard.mjs';
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
