// #143: directories.bin and publishConfig change what pnpm links into dependents, so an edit to
// either in a packages/*/package.json is a dependency change (architect + security), and the
// proof fails closed on anything it cannot parse.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import {
  evaluate,
  dependencyFieldsChanged,
  manifestProofs,
  DEPENDENCY_FIELDS,
} from '../review-gate.mjs';

const P = 'packages/schema/package.json';
const BASE = {
  name: '@pwp/schema',
  version: '0.0.0',
  type: 'module',
  exports: { '.': './src/index.ts' },
  dependencies: { zod: '4.1.0' },
};
const j = (o) => JSON.stringify(o, null, 2);
const with_ = (patch, base = BASE) => j({ ...base, ...patch });

const missing = (files, labels, ctx) =>
  evaluate(files, labels, ctx)
    .missing.map((m) => m.label)
    .sort();

test('link fields: directories and publishConfig are in DEPENDENCY_FIELDS', () => {
  assert.ok(DEPENDENCY_FIELDS.includes('directories'));
  assert.ok(DEPENDENCY_FIELDS.includes('publishConfig'));
});

// --- directories (pnpm links every file in directories.bin when bin is absent) ------------

test('link fields: adding directories.bin is a dependency change', () => {
  const r = dependencyFieldsChanged(j(BASE), with_({ directories: { bin: './bin' } }));
  assert.equal(r.changed, true);
  assert.match(r.why, /\bdirectories\b/);
});

test('link fields: changing directories.bin is a dependency change', () => {
  const base = { ...BASE, directories: { bin: './bin' } };
  const r = dependencyFieldsChanged(j(base), with_({ directories: { bin: './tools' } }, base));
  assert.equal(r.changed, true);
  assert.match(r.why, /\bdirectories\b/);
});

test('link fields: removing directories.bin is a dependency change', () => {
  const base = { ...BASE, directories: { bin: './bin' } };
  assert.equal(dependencyFieldsChanged(j(base), j(BASE)).changed, true);
});

test('link fields: any other directories key counts too (whole-field comparison)', () => {
  const r = dependencyFieldsChanged(j(BASE), with_({ directories: { man: './man' } }));
  assert.equal(r.changed, true);
});

test('link fields: directories with a non-object value still counts as changed', () => {
  for (const v of ['./bin', 1, null, ['./bin'], true]) {
    const r = dependencyFieldsChanged(j(BASE), with_({ directories: v }));
    assert.equal(r.changed, true, `directories: ${JSON.stringify(v)}`);
  }
});

// --- publishConfig (directory + linkDirectory decide which directory dependents link) ------

for (const [label, patch] of [
  ['publishConfig.directory', { publishConfig: { directory: 'dist' } }],
  ['publishConfig.linkDirectory', { publishConfig: { linkDirectory: false } }],
  [
    'publishConfig.directory with linkDirectory',
    { publishConfig: { directory: 'dist', linkDirectory: true } },
  ],
  ['a publishConfig bin override', { publishConfig: { bin: { x: './x.js' } } }],
  ['publishConfig.access', { publishConfig: { access: 'public' } }],
]) {
  test(`link fields: adding ${label} is a dependency change`, () => {
    const r = dependencyFieldsChanged(j(BASE), with_(patch));
    assert.equal(r.changed, true);
    assert.match(r.why, /\bpublishConfig\b/);
  });
}

test('link fields: changing or removing publishConfig.directory is a dependency change', () => {
  const base = { ...BASE, publishConfig: { directory: 'dist' } };
  assert.equal(
    dependencyFieldsChanged(j(base), with_({ publishConfig: { directory: 'lib' } }, base)).changed,
    true,
  );
  assert.equal(dependencyFieldsChanged(j(base), j(BASE)).changed, true);
});

test('link fields: flipping linkDirectory alone is a dependency change', () => {
  const base = { ...BASE, publishConfig: { directory: 'dist', linkDirectory: true } };
  const head = with_({ publishConfig: { directory: 'dist', linkDirectory: false } }, base);
  assert.equal(dependencyFieldsChanged(j(base), head).changed, true);
});

test('link fields: publishConfig with a non-object value still counts as changed', () => {
  for (const v of ['dist', 0, null, ['dist']]) {
    const r = dependencyFieldsChanged(j(BASE), with_({ publishConfig: v }));
    assert.equal(r.changed, true, `publishConfig: ${JSON.stringify(v)}`);
  }
});

test('link fields: unchanged directories and publishConfig do not trigger the row', () => {
  const base = {
    ...BASE,
    directories: { bin: './bin' },
    publishConfig: { directory: 'dist', linkDirectory: true },
  };
  const head = with_({ exports: { '.': './src/index.ts', './x': './src/x.ts' } }, base);
  assert.equal(dependencyFieldsChanged(j(base), head).changed, false);
});

test('link fields: top-level field order does not count, key order inside does (fail closed)', () => {
  const base = { ...BASE, publishConfig: { directory: 'dist', linkDirectory: true } };
  const { publishConfig, ...rest } = base;
  assert.equal(dependencyFieldsChanged(j(base), j({ publishConfig, ...rest })).changed, false);
  const reordered = with_({ publishConfig: { linkDirectory: true, directory: 'dist' } }, base);
  assert.equal(dependencyFieldsChanged(j(base), reordered).changed, true);
});

test('link fields: unparsable manifests fail closed', () => {
  const good = with_({ directories: { bin: './bin' } });
  for (const bad of ['{ "directories": { "bin": ', '', 'null', '[]', '"x"', undefined]) {
    assert.equal(dependencyFieldsChanged(j(BASE), bad).changed, true, `head ${bad}`);
    assert.equal(dependencyFieldsChanged(bad, good).changed, true, `base ${bad}`);
  }
});

test('link fields: deeply nested publishConfig fails closed instead of throwing', () => {
  const deep = `{"publishConfig":${'['.repeat(20000)}${']'.repeat(20000)}}`;
  const r = dependencyFieldsChanged(j(BASE), deep);
  assert.equal(r.changed, true);
});

// --- end to end: manifestProofs + evaluate ------------------------------------------------

const BASE_SHA = 'a'.repeat(40);
const HEAD_SHA = 'b'.repeat(40);
const MB_SHA = 'c'.repeat(40);
const HEAD_BLOB = '1'.repeat(40);

function fakeApi(contents) {
  return async (path) => {
    if (path === 'repos/o/r/pulls/1') return { base: { sha: BASE_SHA }, head: { sha: HEAD_SHA } };
    if (path.startsWith('repos/o/r/compare/')) return { merge_base_commit: { sha: MB_SHA } };
    const m = path.match(/^repos\/o\/r\/contents\/(.+)\?ref=([0-9a-f]+)$/);
    const p = m && decodeURIComponent(m[1]);
    const text = m && contents[m[2]]?.[p];
    if (text === undefined) throw new Error(`GitHub API ${path}: 404`);
    return {
      type: 'file',
      encoding: 'base64',
      content: Buffer.from(text).toString('base64'),
      path: p,
      sha: m[2] === HEAD_SHA ? HEAD_BLOB : '2'.repeat(40),
    };
  };
}
const mod = { filename: P, status: 'modified', sha: HEAD_BLOB };

for (const [label, patch] of [
  ['directories.bin', { directories: { bin: './bin' } }],
  ['publishConfig.directory', { publishConfig: { directory: 'dist' } }],
]) {
  test(`link fields: a PR adding ${label} is not proven and needs architect + security`, async () => {
    const api = fakeApi({ [MB_SHA]: { [P]: j(BASE) }, [HEAD_SHA]: { [P]: with_(patch) } });
    const r = await manifestProofs('o/r', 1, [mod], api);
    assert.equal(r.noDependencyChange.size, 0);
    assert.match(
      r.notes.join('\n'),
      /dependency row kept \(changed: (directories|publishConfig)\)/,
    );
    const ctx = { noDependencyChange: r.noDependencyChange };
    assert.deepEqual(missing([P], ['approved:peer'], ctx), [
      'approved:architect',
      'approved:security',
    ]);
    assert.deepEqual(missing([P], ['approved:peer', 'approved:architect'], ctx), [
      'approved:security',
    ]);
  });
}

test('link fields: a PR leaving both fields alone is still proven (dependency row skipped)', async () => {
  const base = { ...BASE, directories: { bin: './bin' }, publishConfig: { directory: 'dist' } };
  const api = fakeApi({
    [MB_SHA]: { [P]: j(base) },
    [HEAD_SHA]: { [P]: with_({ description: 'pizza schema' }, base) },
  });
  const r = await manifestProofs('o/r', 1, [mod], api);
  assert.deepEqual([...r.noDependencyChange], [P]);
  // packages/*/package.json still needs architect through its own row; security is not added.
  assert.deepEqual(missing([P], ['approved:peer'], { noDependencyChange: r.noDependencyChange }), [
    'approved:architect',
  ]);
});

test('link fields: an unparsable head manifest keeps the dependency row', async () => {
  const api = fakeApi({ [MB_SHA]: { [P]: j(BASE) }, [HEAD_SHA]: { [P]: '{"directories":' } });
  const r = await manifestProofs('o/r', 1, [mod], api);
  assert.equal(r.noDependencyChange.size, 0);
  assert.match(r.notes.join('\n'), /unparsable/);
});
