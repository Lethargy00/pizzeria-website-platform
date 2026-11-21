// #93: the dependency row fires for packages/*/package.json only when a dependency field
// changes, and fails closed whenever that cannot be proven. Also the gate-script security rows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import {
  evaluate,
  dependencyFieldsChanged,
  decodeContents,
  manifestProofs,
  DEPENDENCY_FIELDS,
  DEPENDENCY_PATHS,
  INSTALL_SCRIPTS,
} from '../review-gate.mjs';

const missing = (files, labels, ctx) =>
  evaluate(files, labels, ctx)
    .missing.map((m) => m.label)
    .sort();

const BASE = {
  name: '@pwp/schema',
  type: 'module',
  exports: { '.': './src/index.ts' },
  scripts: { test: 'vitest run' },
  dependencies: { zod: '4.1.0' },
};
const j = (o) => JSON.stringify(o, null, 2);
const with_ = (patch) => j({ ...BASE, ...patch });

// --- dependencyFieldsChanged: one case per field, plus the non-dependency edits -----------

test('deps: an exports-only change is not a dependency change', () => {
  const r = dependencyFieldsChanged(
    j(BASE),
    with_({ exports: { '.': './src/index.ts', './x': './src/x.ts' } }),
  );
  assert.equal(r.changed, false);
});

test('deps: ordinary script, description and keywords edits are not dependency changes', () => {
  const head = with_({
    scripts: { test: 'vitest run --coverage' },
    description: 'x',
    keywords: ['pizza'],
  });
  assert.equal(dependencyFieldsChanged(j(BASE), head).changed, false);
});

test('deps: identical files are not a dependency change', () => {
  assert.equal(dependencyFieldsChanged(j(BASE), j(BASE)).changed, false);
});

for (const field of [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
  'overrides',
  'pnpm',
  'engines',
  'packageManager',
  // #120
  'bin',
  'name',
  'version',
  'devEngines',
  'os',
  'cpu',
  'libc',
]) {
  test(`deps: a change to ${field} is a dependency change`, () => {
    const r = dependencyFieldsChanged(j(BASE), with_({ [field]: { added: '1.0.0' } }));
    assert.equal(r.changed, true);
    assert.match(r.why, new RegExp(`\\b${field}\\b`));
  });
}

test('deps: the #93 fields are all in DEPENDENCY_FIELDS', () => {
  for (const f of [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
    'overrides',
    'pnpm',
    'engines',
    'packageManager',
  ])
    assert.ok(DEPENDENCY_FIELDS.includes(f), f);
});

test('deps: the #120 fields are all in DEPENDENCY_FIELDS', () => {
  for (const f of ['bin', 'name', 'version', 'devEngines', 'os', 'cpu', 'libc'])
    assert.ok(DEPENDENCY_FIELDS.includes(f), f);
});

test('deps: a string bin change (the short form) is a dependency change', () => {
  const r = dependencyFieldsChanged(with_({ bin: './a.js' }), with_({ bin: './b.js' }));
  assert.equal(r.changed, true);
  assert.match(r.why, /\bbin\b/);
});

test('deps: a version bump of the package itself is a dependency change', () => {
  const r = dependencyFieldsChanged(with_({ version: '1.0.0' }), with_({ version: '1.0.1' }));
  assert.equal(r.changed, true);
  assert.match(r.why, /\bversion\b/);
});

// #120 item 1: pin the strict comparison. Reordering keys INSIDE a dependency field counts
// as a change (it can only ask for more review); reordering the top-level fields does not.
// Do not make the comparison order-insensitive without a decision.
test('deps: reordered keys inside dependencies count as a change', () => {
  const base = with_({ dependencies: { a: '1.0.0', b: '2.0.0' } });
  const head = with_({ dependencies: { b: '2.0.0', a: '1.0.0' } });
  assert.equal(dependencyFieldsChanged(base, head).changed, true);
});

test('deps: reordered top-level fields do not count as a change', () => {
  const reordered = Object.fromEntries(Object.entries(BASE).reverse());
  assert.notEqual(j(reordered), j(BASE));
  assert.equal(dependencyFieldsChanged(j(BASE), j(reordered)).changed, false);
});

// #120 item 6: a comparison that throws (JSON.stringify raises RangeError on deep nesting,
// depending on the stack size) must answer "changed" rather than throw. The throw is forced
// so the test does not depend on the Node version's stack size.
test('deps: a comparison that throws fails closed instead of throwing', () => {
  const base = j(BASE);
  const head = with_({ exports: { './x': './x.ts' } }); // would be "not changed"
  assert.equal(dependencyFieldsChanged(base, head).changed, false);
  const stringify = JSON.stringify;
  let r;
  JSON.stringify = () => {
    throw new RangeError('Maximum call stack size exceeded');
  };
  try {
    assert.doesNotThrow(() => {
      r = dependencyFieldsChanged(base, head);
    });
  } finally {
    JSON.stringify = stringify;
  }
  assert.equal(r.changed, true);
  assert.match(r.why, /comparison failed \(RangeError\)/);
});

// Real deep nesting: never throws, whatever the stack size. Unequal values are always
// "changed"; equal ones may be "not changed" (compared fine) or "changed" (comparison threw).
test('deps: very deep nesting never throws', () => {
  const d = 50000;
  const deep = `{"dependencies":${'['.repeat(d)}${']'.repeat(d)}}`;
  let r;
  assert.doesNotThrow(() => {
    r = dependencyFieldsChanged(j(BASE), deep);
  });
  assert.equal(r.changed, true);
  assert.doesNotThrow(() => {
    r = dependencyFieldsChanged(deep, deep);
  });
  assert.equal(typeof r.changed, 'boolean');
});

test('deps: a version bump inside dependencies is a dependency change', () => {
  assert.equal(
    dependencyFieldsChanged(j(BASE), with_({ dependencies: { zod: '4.2.0' } })).changed,
    true,
  );
});

test('deps: removing a dependency field is a dependency change', () => {
  const rest = { ...BASE };
  delete rest.dependencies;
  assert.equal(dependencyFieldsChanged(j(BASE), j(rest)).changed, true);
});

for (const hook of INSTALL_SCRIPTS) {
  test(`deps: adding the install lifecycle script ${hook} is a dependency change`, () => {
    const r = dependencyFieldsChanged(
      j(BASE),
      with_({ scripts: { ...BASE.scripts, [hook]: 'node x.js' } }),
    );
    assert.equal(r.changed, true);
    assert.match(r.why, new RegExp(`scripts\\.${hook}\\b`));
  });
}

test('deps: a non-object scripts field fails closed', () => {
  assert.equal(dependencyFieldsChanged(j(BASE), with_({ scripts: 'oops' })).changed, true);
});

// Fail closed on anything that cannot be read.
for (const [name, base, head] of [
  ['unparsable head', j(BASE), '{ "dependencies": '],
  ['unparsable base', '{ nope', j(BASE)],
  ['head is an array', j(BASE), '[]'],
  ['head is null', j(BASE), 'null'],
  ['head is a string', j(BASE), '"x"'],
  ['base unavailable', undefined, j(BASE)],
  ['head unavailable', j(BASE), undefined],
]) {
  test(`deps: fails closed when ${name}`, () => {
    assert.equal(dependencyFieldsChanged(base, head).changed, true);
  });
}

// --- evaluate: the row, with and without proof ------------------------------------------

const P = 'packages/schema/package.json';
const proven = { noDependencyChange: new Set([P]) };

test('evaluate: a proven exports-only manifest change needs architect, not the dependency row', () => {
  assert.deepEqual(missing([P], ['approved:peer'], proven), ['approved:architect']);
  const r = evaluate([P], ['approved:peer'], proven);
  assert.ok(!r.required.has('approved:security'));
});

test('evaluate: without proof a manifest change still needs the dependency row (as before #93)', () => {
  assert.deepEqual(missing([P], ['approved:peer']), ['approved:architect', 'approved:security']);
  assert.deepEqual(missing([P], ['approved:peer'], {}), [
    'approved:architect',
    'approved:security',
  ]);
});

test('evaluate: proof for one manifest does not cover another', () => {
  assert.deepEqual(
    missing(['packages/ui/package.json'], ['approved:peer', 'approved:a11y-perf'], proven),
    ['approved:architect', 'approved:security'],
  );
});

test('evaluate: the lockfile and the root, playground and workspace files ignore proof', () => {
  for (const f of [
    'pnpm-lock.yaml',
    'package.json',
    'playground/package.json',
    'pnpm-workspace.yaml',
    '.npmrc',
  ]) {
    const ctx = { noDependencyChange: new Set([f]) };
    const r = evaluate([f], ['approved:peer'], ctx);
    assert.ok(r.required.has('approved:security'), f);
    assert.ok(r.required.has('approved:architect'), f);
  }
});

// #120 item 3: pnpm also reads package.yaml and package.json5. The gate cannot parse them,
// so they always need the dependency row (fail closed), proof or not.
for (const f of [
  'package.yaml',
  'package.json5',
  'playground/package.yaml',
  'playground/package.json5',
  'packages/schema/package.yaml',
  'packages/schema/package.json5',
  'packages/core/package.yaml',
]) {
  test(`evaluate: alternative manifest ${f} always needs the dependency row`, () => {
    const ctx = { noDependencyChange: new Set([f]) };
    for (const c of [undefined, ctx]) {
      const r = evaluate([f], ['approved:peer'], c);
      assert.ok(r.required.has('approved:architect'), f);
      assert.ok(r.required.has('approved:security'), f);
      assert.match(r.required.get('approved:security').join('\n'), /dependency change/);
    }
  });
}

test('evaluate: the alternative manifest globs are in DEPENDENCY_PATHS', () => {
  for (const g of ['packages/*/package.{yaml,json5}', 'package.{yaml,json5}'])
    assert.ok(DEPENDENCY_PATHS.includes(g), g);
});

test('evaluate: package.yml (not read by pnpm) and nested package.yaml are not caught by the new globs', () => {
  for (const f of ['packages/schema/package.yml', 'packages/schema/src/package.yaml'])
    assert.ok(!evaluate([f], []).required.has('approved:security'), f);
});

test('evaluate: a proven manifest plus a lockfile change still needs the dependency row', () => {
  assert.deepEqual(missing([P, 'pnpm-lock.yaml'], ['approved:peer'], proven), [
    'approved:architect',
    'approved:security',
  ]);
});

test('evaluate: packages/core/package.json keeps approved:security through the richtext row', () => {
  const ctx = { noDependencyChange: new Set(['packages/core/package.json']) };
  assert.deepEqual(missing(['packages/core/package.json'], ['approved:peer'], ctx), [
    'approved:architect',
    'approved:security',
  ]);
  const reasons = evaluate(['packages/core/package.json'], [], ctx).required.get(
    'approved:security',
  );
  assert.equal(reasons.length, 1);
  assert.match(reasons[0], /ADR 0002 \(c\)/);
});

test('evaluate: a proven manifest on a security:sensitive PR still needs security', () => {
  assert.deepEqual(missing([P], ['approved:peer', 'security:sensitive'], proven), [
    'approved:architect',
    'approved:security',
  ]);
});

// --- security rows for the gate scripts (#93 comments) ----------------------------------

for (const f of [
  'scripts/lib/glob.mjs',
  'scripts/lib/fs-walk.mjs',
  'scripts/lib/new/helper.mjs',
  'scripts/tenant-guard.mjs',
  'scripts/touches-guard.mjs',
  'scripts/new-guard.mjs',
  'scripts/review-gate.mjs',
  'scripts/check-licenses.mjs', // the license gate in security.yml (#128)
]) {
  test(`security row: ${f} needs approved:security`, () => {
    assert.deepEqual(missing([f], ['approved:peer']), ['approved:security']);
    assert.deepEqual(missing([f], ['approved:peer', 'approved:security']), []);
  });
}

for (const f of [
  'scripts/check-example.mjs', // #128 added only check-licenses.mjs, not scripts/check-*.mjs
  'scripts/typecheck.mjs',
  'scripts/test/guards.test.mjs',
  'scripts/guard-notes.md',
]) {
  test(`security row: ${f} stays peer-only`, () => {
    assert.deepEqual(missing([f], ['approved:peer']), []);
  });
}

// --- decodeContents -----------------------------------------------------------------------

test('decodeContents: with expect, the entry must be for that path and blob', () => {
  const content = Buffer.from('{"a":1}').toString('base64');
  const e = { type: 'file', encoding: 'base64', content, path: P, sha: 'd'.repeat(40) };
  assert.equal(decodeContents(e, { path: P, sha: 'd'.repeat(40) }), '{"a":1}');
  assert.equal(decodeContents(e, { path: P }), '{"a":1}');
  assert.equal(decodeContents(e, { path: 'packages/x/target.json' }), undefined);
  assert.equal(decodeContents(e, { path: P, sha: 'e'.repeat(40) }), undefined);
  assert.equal(decodeContents(e, { path: P, sha: undefined }), undefined); // no sha listed
  assert.equal(decodeContents({ ...e, path: undefined }, { path: P }), undefined);
  assert.equal(
    decodeContents({ ...e, sha: undefined }, { path: P, sha: 'd'.repeat(40) }),
    undefined,
  );
});

test('decodeContents: decodes an inline base64 file and rejects everything else', () => {
  const content = Buffer.from('{"a":1}').toString('base64');
  assert.equal(decodeContents({ type: 'file', encoding: 'base64', content }), '{"a":1}');
  assert.equal(decodeContents({ type: 'file', encoding: 'none', content: '' }), undefined); // > 1 MB
  assert.equal(decodeContents({ type: 'dir' }), undefined);
  assert.equal(decodeContents([]), undefined);
  assert.equal(decodeContents(null), undefined);
});

// --- manifestProofs, with a fake API ------------------------------------------------------

const BASE_SHA = 'a'.repeat(40);
const HEAD_SHA = 'b'.repeat(40);
const MB_SHA = 'c'.repeat(40);
/** Blob shas the fake API reports: one for every head file, one for every merge-base file. */
const HEAD_BLOB = '1'.repeat(40);
const MB_BLOB = '2'.repeat(40);
const file = (text, path, sha) => ({
  type: 'file',
  encoding: 'base64',
  content: Buffer.from(text).toString('base64'),
  path,
  sha,
});

/**
 * Fake GitHub API: contents[ref][path] is the file text; anything missing throws (like a 404).
 * Like the real API, each contents entry carries its path and blob sha. `entry` can rewrite
 * an entry to model a symlink answer (another path) or a different blob.
 */
function fakeApi({ contents = {}, pull, compare, entry = (e) => e } = {}) {
  const calls = [];
  const api = async (path) => {
    calls.push(path);
    if (/^repos\/o\/r\/pulls\/1$/.test(path))
      return pull ?? { base: { sha: BASE_SHA }, head: { sha: HEAD_SHA } };
    if (path.startsWith('repos/o/r/compare/')) {
      if (compare) return compare(path);
      return { merge_base_commit: { sha: MB_SHA } };
    }
    const m = path.match(/^repos\/o\/r\/contents\/(.+)\?ref=([0-9a-f]+)$/);
    const text = m && contents[m[2]]?.[decodeURIComponent(m[1])];
    if (text === undefined) throw new Error(`GitHub API ${path}: 404`);
    const p = decodeURIComponent(m[1]);
    return entry(file(text, p, m[2] === HEAD_SHA ? HEAD_BLOB : MB_BLOB), m[2]);
  };
  return { api, calls };
}
const mod = (filename, extra = {}) => ({
  filename,
  status: 'modified',
  sha: HEAD_BLOB,
  ...extra,
});

test('proofs: an exports-only change is proven, compared at the merge base and the head', async () => {
  const { api, calls } = fakeApi({
    contents: {
      [MB_SHA]: { [P]: j(BASE) },
      [HEAD_SHA]: { [P]: with_({ exports: { './y': './y.ts' } }) },
    },
  });
  const r = await manifestProofs('o/r', 1, [mod(P)], api);
  assert.deepEqual([...r.noDependencyChange], [P]);
  assert.ok(calls.includes(`repos/o/r/compare/${BASE_SHA}...${HEAD_SHA}?per_page=1`));
  assert.ok(calls.includes(`repos/o/r/contents/packages/schema/package.json?ref=${MB_SHA}`));
  assert.ok(!calls.some((c) => c.includes(`ref=${BASE_SHA}`)), 'compares against the merge base');
});

test('proofs: a dependencies change is not proven', async () => {
  const { api } = fakeApi({
    contents: {
      [MB_SHA]: { [P]: j(BASE) },
      [HEAD_SHA]: { [P]: with_({ dependencies: { zod: '5.0.0' } }) },
    },
  });
  const r = await manifestProofs('o/r', 1, [mod(P)], api);
  assert.equal(r.noDependencyChange.size, 0);
  assert.match(r.notes.join('\n'), /changed: dependencies/);
});

test('proofs: an unparsable head file is not proven', async () => {
  const { api } = fakeApi({
    contents: { [MB_SHA]: { [P]: j(BASE) }, [HEAD_SHA]: { [P]: '{ broken' } },
  });
  const r = await manifestProofs('o/r', 1, [mod(P)], api);
  assert.equal(r.noDependencyChange.size, 0);
  assert.match(r.notes.join('\n'), /unparsable/);
});

test('proofs: a failed content fetch is not proven', async () => {
  const { api } = fakeApi({ contents: { [MB_SHA]: { [P]: j(BASE) } } });
  const r = await manifestProofs('o/r', 1, [mod(P)], api);
  assert.equal(r.noDependencyChange.size, 0);
  assert.match(r.notes.join('\n'), /404/);
});

test('proofs: a file too large to inline (encoding none) is not proven', async () => {
  const api = async (path) => {
    if (path.endsWith('/pulls/1')) return { base: { sha: BASE_SHA }, head: { sha: HEAD_SHA } };
    if (path.includes('/compare/')) return { merge_base_commit: { sha: MB_SHA } };
    return { type: 'file', encoding: 'none', content: '' };
  };
  const r = await manifestProofs('o/r', 1, [mod(P)], api);
  assert.equal(r.noDependencyChange.size, 0);
});

for (const status of ['added', 'removed', 'renamed', 'copied', 'changed']) {
  test(`proofs: a manifest with status ${status} is not proven and is not fetched`, async () => {
    const { api, calls } = fakeApi({
      contents: { [MB_SHA]: { [P]: j(BASE) }, [HEAD_SHA]: { [P]: j(BASE) } },
    });
    const r = await manifestProofs('o/r', 1, [{ filename: P, status }], api);
    assert.equal(r.noDependencyChange.size, 0);
    assert.ok(!calls.some((c) => c.includes('/contents/')));
  });
}

test('proofs: a rename into a manifest path is not proven, even if marked modified', async () => {
  const { api } = fakeApi({
    contents: { [MB_SHA]: { [P]: j(BASE) }, [HEAD_SHA]: { [P]: j(BASE) } },
  });
  const r = await manifestProofs(
    'o/r',
    1,
    [mod(P, { previous_filename: 'packages/schema/old.json' })],
    api,
  );
  assert.equal(r.noDependencyChange.size, 0);
});

// #120 item 4: the fetched content must be the files-list entry (path + blob sha).
const unchanged = {
  contents: {
    [MB_SHA]: { [P]: j(BASE) },
    [HEAD_SHA]: { [P]: with_({ exports: { './y': './y.ts' } }) },
  },
};

test('proofs: the control case for the path/sha checks is proven', async () => {
  const { api } = fakeApi(unchanged);
  const r = await manifestProofs('o/r', 1, [mod(P)], api);
  assert.deepEqual([...r.noDependencyChange], [P]);
});

test('proofs: a head entry for another path (symlink answer) is not proven', async () => {
  const { api } = fakeApi({
    ...unchanged,
    entry: (e, ref) => (ref === HEAD_SHA ? { ...e, path: 'packages/schema/target.json' } : e),
  });
  const r = await manifestProofs('o/r', 1, [mod(P)], api);
  assert.equal(r.noDependencyChange.size, 0);
  assert.match(r.notes.join('\n'), /not the listed path and blob/);
});

test('proofs: a base entry for another path is not proven', async () => {
  const { api } = fakeApi({
    ...unchanged,
    entry: (e, ref) => (ref === MB_SHA ? { ...e, path: 'packages/schema/target.json' } : e),
  });
  const r = await manifestProofs('o/r', 1, [mod(P)], api);
  assert.equal(r.noDependencyChange.size, 0);
});

test('proofs: a head blob sha that differs from the files list is not proven', async () => {
  const { api } = fakeApi(unchanged);
  const r = await manifestProofs('o/r', 1, [mod(P, { sha: 'f'.repeat(40) })], api);
  assert.equal(r.noDependencyChange.size, 0);
  assert.match(r.notes.join('\n'), /not the listed path and blob/);
});

test('proofs: a files-list entry without a sha is not proven', async () => {
  const { api } = fakeApi(unchanged);
  const r = await manifestProofs('o/r', 1, [mod(P, { sha: undefined })], api);
  assert.equal(r.noDependencyChange.size, 0);
});

test('proofs: a missing merge base proves nothing', async () => {
  const { api } = fakeApi({
    contents: { [MB_SHA]: { [P]: j(BASE) }, [HEAD_SHA]: { [P]: j(BASE) } },
    compare: () => ({}),
  });
  const r = await manifestProofs('o/r', 1, [mod(P)], api);
  assert.equal(r.noDependencyChange.size, 0);
  assert.match(r.notes.join('\n'), /merge base or head commit unknown/);
});

test('proofs: a failing pulls or compare call proves nothing', async () => {
  const { api } = fakeApi({
    contents: { [MB_SHA]: { [P]: j(BASE) }, [HEAD_SHA]: { [P]: j(BASE) } },
    compare: () => {
      throw new Error('GitHub API compare: 500');
    },
  });
  const r = await manifestProofs('o/r', 1, [mod(P)], api);
  assert.equal(r.noDependencyChange.size, 0);
  assert.match(r.notes.join('\n'), /500/);
});

test('proofs: a non-sha head proves nothing', async () => {
  const { api } = fakeApi({ pull: { base: { sha: BASE_SHA }, head: { sha: 'main' } } });
  const r = await manifestProofs('o/r', 1, [mod(P)], api);
  assert.equal(r.noDependencyChange.size, 0);
});

test('proofs: no manifest in the PR means no API calls', async () => {
  const { api, calls } = fakeApi();
  const r = await manifestProofs('o/r', 1, [mod('README.md'), mod('package.json')], api);
  assert.equal(r.noDependencyChange.size, 0);
  assert.equal(calls.length, 0);
});

test('proofs: each manifest is judged on its own', async () => {
  const U = 'packages/ui/package.json';
  const { api } = fakeApi({
    contents: {
      [MB_SHA]: { [P]: j(BASE), [U]: j(BASE) },
      [HEAD_SHA]: { [P]: with_({ exports: {} }), [U]: with_({ devDependencies: { x: '1.0.0' } }) },
    },
  });
  const r = await manifestProofs('o/r', 1, [mod(P), mod(U)], api);
  assert.deepEqual([...r.noDependencyChange], [P]);
  assert.deepEqual(missing([P, U], ['approved:peer', 'approved:a11y-perf'], r), [
    'approved:architect',
    'approved:security',
  ]);
});

test('proofs + evaluate end to end: exports-only PR needs peer and architect only', async () => {
  const { api } = fakeApi({
    contents: {
      [MB_SHA]: { [P]: j(BASE) },
      [HEAD_SHA]: { [P]: with_({ exports: { './z': './z.ts' } }) },
    },
  });
  const ctx = await manifestProofs('o/r', 1, [mod(P)], api);
  assert.deepEqual(missing([P], [], ctx), ['approved:architect', 'approved:peer']);
});
