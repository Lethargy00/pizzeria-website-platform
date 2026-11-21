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

test('deps: ordinary script, description and version edits are not dependency changes', () => {
  const head = with_({
    scripts: { test: 'vitest run --coverage' },
    description: 'x',
    version: '1.0.1',
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
]) {
  test(`security row: ${f} needs approved:security`, () => {
    assert.deepEqual(missing([f], ['approved:peer']), ['approved:security']);
    assert.deepEqual(missing([f], ['approved:peer', 'approved:security']), []);
  });
}

for (const f of [
  'scripts/check-licenses.mjs',
  'scripts/typecheck.mjs',
  'scripts/test/guards.test.mjs',
  'scripts/guard-notes.md',
]) {
  test(`security row: ${f} stays peer-only`, () => {
    assert.deepEqual(missing([f], ['approved:peer']), []);
  });
}

// --- decodeContents -----------------------------------------------------------------------

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
const file = (text) => ({
  type: 'file',
  encoding: 'base64',
  content: Buffer.from(text).toString('base64'),
});

/** Fake GitHub API: contents[ref][path] is the file text; anything missing throws (like a 404). */
function fakeApi({ contents = {}, pull, compare } = {}) {
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
    return file(text);
  };
  return { api, calls };
}
const mod = (filename, extra = {}) => ({ filename, status: 'modified', ...extra });

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
