// #176: a file that an install script runs, or a manifest field it reads through npm_package_*,
// changes what pnpm install runs. So while a manifest declares an install-type lifecycle script
// (or has a binding.gyp beside it), every change under its directory, and under the directory
// of every path its scripts name, needs the dependency row. Everything unreadable fails closed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import {
  evaluate,
  dependencyFieldsChanged,
  installScriptCoverage,
  scriptTargetDirs,
  coveredByInstallScript,
  INSTALL_SCRIPTS,
} from '../review-gate.mjs';

const missing = (files, labels, ctx) =>
  evaluate(files, labels, ctx)
    .missing.map((m) => m.label)
    .sort();

const MB = 'a'.repeat(40); // merge base commit
const TIP = 'b'.repeat(40); // base branch tip commit
const HEAD = 'c'.repeat(40); // PR head commit
const PULL_BASE = 'd'.repeat(40);

let blobCounter = 0;
/** A fresh 40-hex blob sha. */
const nextSha = () => (++blobCounter).toString(16).padStart(40, '0');

/**
 * Fake GitHub API. trees[commit] maps a path to file text (or to an entry object with
 * {text, mode} to model a symlink). Blobs are addressed by sha, like the real API.
 * `fail` makes any matching call throw; `patch` rewrites a response.
 */
function fakeApi({ trees, fail = () => false, patch = (_p, r) => r, baseRef = 'main' }) {
  const blobs = new Map();
  const treeOf = {};
  for (const [commit, files] of Object.entries(trees)) {
    const entries = [];
    for (const [path, v] of Object.entries(files)) {
      const { text, mode = '100644' } = typeof v === 'string' ? { text: v } : v;
      let sha = [...blobs].find(([, t]) => t === text)?.[0];
      if (!sha) {
        sha = nextSha();
        blobs.set(sha, text);
      }
      entries.push({ path, mode, type: 'blob', sha });
    }
    treeOf[commit] = { sha: commit.replace(/./, 'e'), tree: entries, truncated: false };
  }
  const calls = [];
  const api = async (path) => {
    calls.push(path);
    if (fail(path)) throw new Error(`GitHub API ${path}: 500`);
    return patch(path, answer(path));
  };
  function answer(path) {
    if (path === 'repos/o/r/pulls/1')
      return { base: { sha: PULL_BASE, ref: baseRef }, head: { sha: HEAD } };
    if (path === `repos/o/r/compare/${PULL_BASE}...${HEAD}?per_page=1`)
      return { merge_base_commit: { sha: MB } };
    if (path === `repos/o/r/git/ref/heads/${baseRef}`)
      return { object: { type: 'commit', sha: TIP } };
    let m = path.match(/^repos\/o\/r\/git\/commits\/([0-9a-f]{40})$/);
    if (m && treeOf[m[1]]) return { sha: m[1], tree: { sha: treeOf[m[1]].sha } };
    m = path.match(/^repos\/o\/r\/git\/trees\/([0-9a-f]{40})\?recursive=1$/);
    const t = m && Object.values(treeOf).find((x) => x.sha === m[1]);
    if (t) return { sha: t.sha, tree: t.tree, truncated: t.truncated };
    m = path.match(/^repos\/o\/r\/git\/blobs\/([0-9a-f]{40})$/);
    if (m && blobs.has(m[1]))
      return {
        sha: m[1],
        encoding: 'base64',
        content: Buffer.from(blobs.get(m[1])).toString('base64'),
      };
    throw new Error(`GitHub API ${path}: 404`);
  }
  return { api, calls };
}

const j = (o) => JSON.stringify(o, null, 2);
const UI = 'packages/ui/package.json';
const plain = j({ name: '@pwp/ui', scripts: { test: 'vitest run' } });
const withPost = (cmd = 'node scripts/setup.mjs', key = 'postinstall') =>
  j({ name: '@pwp/ui', scripts: { test: 'vitest run', [key]: cmd } });
/** The same repo at all three commits, plus per-commit overrides. */
const repo = (files, over = {}) => ({
  [MB]: { ...files, ...over[MB] },
  [TIP]: { ...files, ...over[TIP] },
  [HEAD]: { ...files, ...over[HEAD] },
});
const ROOT = { 'package.json': j({ name: 'root', private: true, scripts: { test: 'vitest' } }) };
const coverage = async (trees, opts) =>
  installScriptCoverage('o/r', 1, fakeApi({ trees, ...opts }).api);

// --- the acceptance criteria ---------------------------------------------------------------

test('install: a package with a postinstall script whose target file changes needs approved:security', async () => {
  const { dirs } = await coverage(repo({ ...ROOT, [UI]: withPost() }));
  assert.deepEqual(dirs, ['packages/ui', 'packages/ui/scripts']);
  const files = ['packages/ui/scripts/setup.mjs'];
  const m = missing(files, ['approved:peer', 'approved:a11y-perf'], { installScriptDirs: dirs });
  assert.ok(m.includes('approved:security'), m.join(', '));
  assert.ok(m.includes('approved:architect'), 'the dependency row asks for both');
  const r = evaluate(files, [], { installScriptDirs: dirs });
  assert.match(r.required.get('approved:security').join('\n'), /dependency change/);
});

test('install: a package with no install script is unaffected', async () => {
  const { dirs, notes } = await coverage(
    repo({ ...ROOT, [UI]: plain, 'packages/core/package.json': j({ name: '@pwp/core' }) }),
  );
  assert.deepEqual(dirs, []);
  assert.deepEqual(notes, []);
  assert.deepEqual(
    missing(['packages/core/src/util.ts', 'packages/core/scripts/setup.mjs'], [], {
      installScriptDirs: dirs,
    }),
    ['approved:peer'],
  );
});

test('install: other files in the same package are covered too (the target imports them)', async () => {
  const { dirs } = await coverage(repo({ ...ROOT, [UI]: withPost() }));
  assert.ok(
    missing(['packages/ui/src/lib/helper.ts'], [], { installScriptDirs: dirs }).includes(
      'approved:security',
    ),
  );
  // Another package stays as before.
  assert.deepEqual(missing(['packages/core/src/x.ts'], [], { installScriptDirs: dirs }), [
    'approved:peer',
  ]);
});

test('install: every install-type hook is detected', async () => {
  for (const hook of INSTALL_SCRIPTS) {
    const { dirs } = await coverage(repo({ ...ROOT, [UI]: withPost('node x.mjs', hook) }));
    assert.deepEqual(dirs, ['packages/ui'], hook);
  }
});

test('install: non-install scripts (build, test, prepack) do not cover anything', async () => {
  for (const hook of ['build', 'test', 'prepack', 'postpack', 'prepublishOnly', 'start']) {
    const { dirs } = await coverage(repo({ ...ROOT, [UI]: withPost('node x.mjs', hook) }));
    assert.deepEqual(dirs, [], hook);
  }
});

test('install: a target outside the package covers its directory', async () => {
  const { dirs } = await coverage(
    repo({ ...ROOT, [UI]: withPost('node ../../tools/setup/run.mjs && node ./local.mjs') }),
  );
  assert.deepEqual(dirs, ['packages/ui', 'tools/setup']);
  assert.ok(
    missing(['tools/setup/lib/a.mjs'], [], { installScriptDirs: dirs }).includes(
      'approved:security',
    ),
  );
  assert.deepEqual(missing(['tools/other.mjs'], [], { installScriptDirs: dirs }), [
    'approved:peer',
  ]);
});

test('install: an install script in the root manifest covers every path', async () => {
  const { dirs } = await coverage(
    repo({ 'package.json': j({ name: 'root', scripts: { 'pnpm:devPreinstall': 'node x.mjs' } }) }),
  );
  assert.deepEqual(dirs, ['']);
  assert.ok(missing(['README.md'], [], { installScriptDirs: dirs }).includes('approved:architect'));
});

test('install: a binding.gyp makes pnpm run node-gyp, so its directory is covered', async () => {
  const { dirs } = await coverage(
    repo({ ...ROOT, [UI]: plain, 'packages/ui/Binding.GYP': "{ 'targets': [] }" }),
  );
  assert.deepEqual(dirs, ['packages/ui']);
});

test('install: a script declared only at the merge base still covers its directory', async () => {
  const { dirs } = await coverage(repo({ ...ROOT, [UI]: plain }, { [MB]: { [UI]: withPost() } }));
  assert.deepEqual(dirs, ['packages/ui', 'packages/ui/scripts']);
});

test('install: a script that landed on the base branch after the PR branched still counts', async () => {
  const { dirs } = await coverage(repo({ ...ROOT, [UI]: plain }, { [TIP]: { [UI]: withPost() } }));
  assert.deepEqual(dirs, ['packages/ui', 'packages/ui/scripts']);
});

test('install: a script added at the PR head counts', async () => {
  const { dirs } = await coverage(repo({ ...ROOT, [UI]: plain }, { [HEAD]: { [UI]: withPost() } }));
  assert.deepEqual(dirs, ['packages/ui', 'packages/ui/scripts']);
});

test('install: manifests outside the workspace globs are read too', async () => {
  const { dirs } = await coverage(
    repo({ ...ROOT, 'tools/x/package.json': withPost('node run.mjs', 'preinstall') }),
  );
  assert.deepEqual(dirs, ['tools/x']);
});

test('install: a manifest with a byte order mark is still read', async () => {
  const { dirs } = await coverage(repo({ ...ROOT, [UI]: `\uFEFF${withPost()}` }));
  assert.deepEqual(dirs, ['packages/ui', 'packages/ui/scripts']);
});

test('install: coverage is case-insensitive (#162)', async () => {
  const { dirs } = await coverage(repo({ ...ROOT, 'packages/UI/package.json': withPost() }));
  assert.deepEqual(dirs, ['packages/ui', 'packages/ui/scripts']);
  assert.ok(coveredByInstallScript('PACKAGES/ui/Scripts/setup.mjs', dirs));
  assert.ok(coveredByInstallScript('packages/ui', dirs));
  assert.ok(!coveredByInstallScript('packages/ui-kit/x.ts', dirs), 'prefix is a whole segment');
});

test('install: calls read the trees and blobs by sha, each blob once', async () => {
  const { api, calls } = fakeApi({ trees: repo({ ...ROOT, [UI]: withPost() }) });
  await installScriptCoverage('o/r', 1, api);
  assert.ok(calls.includes('repos/o/r/git/ref/heads/main'));
  const blobCalls = calls.filter((c) => c.includes('/git/blobs/'));
  assert.equal(blobCalls.length, new Set(blobCalls).size);
  assert.equal(blobCalls.length, 2);
});

test('install: a base branch name with a slash is encoded per segment', async () => {
  const { api, calls } = fakeApi({ trees: repo(ROOT), baseRef: 'release/v1' });
  const r = await installScriptCoverage('o/r', 1, api);
  assert.deepEqual(r.dirs, []);
  assert.ok(calls.includes('repos/o/r/git/ref/heads/release/v1'));
});

// --- fail closed ---------------------------------------------------------------------------

const failClosed = [
  ['the pulls API fails', { fail: (p) => p === 'repos/o/r/pulls/1' }],
  ['the compare API fails', { fail: (p) => p.includes('/compare/') }],
  ['the merge base is missing', { patch: (p, r) => (p.includes('/compare/') ? {} : r) }],
  [
    'the head sha is malformed',
    { patch: (p, r) => (p.endsWith('/pulls/1') ? { ...r, head: { sha: 'HEAD' } } : r) },
  ],
  [
    'the base ref is missing',
    { patch: (p, r) => (p.endsWith('/pulls/1') ? { ...r, base: { sha: PULL_BASE } } : r) },
  ],
  ['the base tip lookup fails', { fail: (p) => p.includes('/git/ref/') }],
  [
    'the base ref is not a commit',
    { patch: (p, r) => (p.includes('/git/ref/') ? { object: { ...r.object, type: 'tag' } } : r) },
  ],
  ['a commit lookup fails', { fail: (p) => p === `repos/o/r/git/commits/${TIP}` }],
  ['a commit has no tree', { patch: (p, r) => (p.includes('/git/commits/') ? { sha: r.sha } : r) }],
  [
    'a tree is truncated',
    { patch: (p, r) => (p.includes('/git/trees/') ? { ...r, truncated: true } : r) },
  ],
  [
    'a tree has no truncated flag',
    { patch: (p, r) => (p.includes('/git/trees/') ? { sha: r.sha, tree: r.tree } : r) },
  ],
  ['a tree lookup fails', { fail: (p) => p.includes('/git/trees/') }],
  ['a blob lookup fails', { fail: (p) => p.includes('/git/blobs/') }],
  [
    'a blob answers for another sha',
    { patch: (p, r) => (p.includes('/git/blobs/') ? { ...r, sha: 'f'.repeat(40) } : r) },
  ],
  [
    'a blob is not base64',
    { patch: (p, r) => (p.includes('/git/blobs/') ? { ...r, encoding: 'utf-8' } : r) },
  ],
];
for (const [name, opts] of failClosed) {
  test(`install: fails closed to every path when ${name}`, async () => {
    const r = await coverage(repo({ ...ROOT, [UI]: plain }), opts);
    assert.deepEqual(r.dirs, ['']);
    assert.match(r.notes.join('\n'), /every path counts/);
    assert.ok(
      missing(['docs/x.md'], [], { installScriptDirs: r.dirs }).includes('approved:security'),
    );
  });
}

const badManifests = [
  ['an unparsable manifest', { [UI]: '{ "scripts": ' }],
  ['a manifest that is an array', { [UI]: '[]' }],
  ['scripts that are a string', { [UI]: j({ scripts: 'node x.js' }) }],
  ['scripts that are an array', { [UI]: j({ scripts: ['node x.js'] }) }],
  ['a package.yaml anywhere', { 'tools/package.yaml': 'name: x' }],
  ['a package.json5 anywhere', { 'packages/ui/Package.JSON5': '{}' }],
  ['a symlinked manifest', { [UI]: { text: '../../evil/package.json', mode: '120000' } }],
  ['an install script that is not a string', { [UI]: j({ scripts: { postinstall: ['x'] } }) }],
  ['a script using a variable', { [UI]: withPost('node $npm_package_config_entry') }],
  ['a script with a quoted path', { [UI]: withPost('node "scripts/a b.mjs"') }],
  ['a script with inline code', { [UI]: withPost("node -e require('./x')") }],
  ['a script with command substitution', { [UI]: withPost('node `cat entry`') }],
  ['a script with a glob', { [UI]: withPost('node scripts/*.mjs') }],
  ['a script with a home path', { [UI]: withPost('node ~/x.mjs') }],
  ['a script with a backslash path', { [UI]: withPost('node ..\\..\\x.mjs') }],
  ['a script with an absolute path', { [UI]: withPost('node /opt/x.mjs') }],
  ['a script path that leaves the repo', { [UI]: withPost('node ../../../x.mjs') }],
];
for (const [name, files] of badManifests) {
  test(`install: fails closed to every path on ${name}`, async () => {
    const r = await coverage(repo({ ...ROOT, ...files }));
    assert.deepEqual(r.dirs, [''], r.notes.join('\n'));
  });
}

test('install: a bad manifest only at the PR head still fails closed', async () => {
  const r = await coverage(repo({ ...ROOT, [UI]: plain }, { [HEAD]: { [UI]: '{' } }));
  assert.deepEqual(r.dirs, ['']);
});

test('install: never throws, even on a broken API', async () => {
  const r = await installScriptCoverage('o/r', 1, () => {
    throw new TypeError('boom');
  });
  assert.deepEqual(r.dirs, ['']);
});

test('install: evaluate without installScriptDirs keeps the old behaviour', () => {
  assert.deepEqual(missing(['packages/core/src/x.ts'], []), ['approved:peer']);
  assert.equal(coveredByInstallScript('x', undefined), false);
  assert.equal(coveredByInstallScript('x', []), false);
});

// --- scriptTargetDirs ----------------------------------------------------------------------

test('targets: bare words name no path', () => {
  assert.deepEqual(scriptTargetDirs('packages/ui', 'node-gyp rebuild'), []);
  assert.deepEqual(scriptTargetDirs('packages/ui', 'husky'), []);
  assert.deepEqual(scriptTargetDirs('packages/ui', ''), []);
});

test('targets: paths resolve against the manifest directory', () => {
  assert.deepEqual(scriptTargetDirs('packages/ui', 'node ./scripts/a.mjs'), [
    'packages/ui/scripts',
  ]);
  assert.deepEqual(scriptTargetDirs('packages/ui', 'node setup.mjs'), []);
  assert.deepEqual(scriptTargetDirs('packages/ui', 'node --require=./hooks/r.cjs x'), [
    'packages/ui/hooks',
  ]);
  assert.deepEqual(scriptTargetDirs('packages/ui', 'node ../core/x.mjs; node ../../a/b.mjs'), [
    'packages/core',
    'a',
  ]);
  assert.deepEqual(scriptTargetDirs('', 'node scripts/x.mjs'), ['scripts']);
  assert.deepEqual(scriptTargetDirs('', 'node ./'), ['']);
  assert.deepEqual(scriptTargetDirs('packages/ui', 'node ../../x.mjs'), ['']);
  assert.deepEqual(scriptTargetDirs('packages/ui', 'node ./tools/'), ['packages/ui']);
});

test('targets: words the gate cannot resolve throw', () => {
  for (const cmd of ['node $X', 'node "a"', "node 'a'", 'node `x`', 'node a*', 'node ~/a']) {
    assert.throws(() => scriptTargetDirs('packages/ui', cmd), /cannot resolve/, cmd);
  }
  for (const cmd of [
    'node -e x',
    'node --eval=x',
    'node -p x',
    'sh -c x',
    'cd sub && node ../../../a/b.mjs',
    'pushd sub',
    'pnpm -C ../core exec x',
    'npm --prefix=../core run x',
    'pnpm --dir ../core run x',
  ]) {
    assert.throws(() => scriptTargetDirs('packages/ui', cmd), /cannot resolve/, cmd);
  }
  assert.throws(() => scriptTargetDirs('packages/ui', 'node /x'), /absolute/);
  assert.throws(() => scriptTargetDirs('packages/ui', 'node ../../..'), /leaves the repo/);
  assert.throws(() => scriptTargetDirs('packages/ui', 42), /not a string/);
});

// --- the manifest itself -------------------------------------------------------------------

const MAN = { name: '@pwp/ui', scripts: { postinstall: 'node x.mjs' }, description: 'a' };

test('manifest: any change to a manifest that declares an install script is a dependency change', () => {
  const r = dependencyFieldsChanged(j(MAN), j({ ...MAN, description: 'b' }));
  assert.equal(r.changed, true);
  assert.match(r.why, /scripts\.postinstall/);
  const exp = dependencyFieldsChanged(j(MAN), j({ ...MAN, exports: { '.': './x.ts' } }));
  assert.equal(exp.changed, true);
});

test('manifest: removing the install script together with another edit is a dependency change', () => {
  const rest = { ...MAN, scripts: {} };
  assert.equal(dependencyFieldsChanged(j(MAN), j({ ...rest, description: 'b' })).changed, true);
});

test('manifest: a reformat-only change with an install script is not a field change', () => {
  // Same object, different whitespace: nothing pnpm reads differs.
  assert.equal(dependencyFieldsChanged(j(MAN), JSON.stringify(MAN)).changed, false);
});

test('manifest: without an install script, a description change is still not a dependency change', () => {
  const base = { name: '@pwp/ui', scripts: { test: 'vitest' }, description: 'a' };
  assert.equal(dependencyFieldsChanged(j(base), j({ ...base, description: 'b' })).changed, false);
});
