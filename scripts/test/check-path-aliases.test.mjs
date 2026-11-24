// #190: check-path-aliases refuses tracked paths that macOS or Windows open as another path:
// a case variant of another tracked path or of a reviewed review-gate path, a segment ending in
// "." or a space, a non-NFC name, and default-ignorable or control code points. The last tests
// run the pr-gates.yml step itself against a local fake of the GitHub trees API.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkPaths,
  caseAliasOf,
  compileGlob,
  entriesOf,
  expandBraces,
  gitPaths,
  splitNul,
  treePaths,
  REVIEWED_GLOBS,
  MAX_SEGMENT_BYTES,
} from '../check-path-aliases.mjs';
import { DEPENDENCY_PATHS, PACKAGE_MANIFESTS, RICHTEXT_PATHS } from '../review-gate.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const rules = (paths) => checkPaths(paths).map((p) => `${p.path} ${p.rule}`);
const rulesOf = (paths) => [...new Set(checkPaths(paths).map((p) => p.rule))].sort();

// ---- the reviewed globs come from review-gate ----

test('REVIEWED_GLOBS is exactly the review-gate dependency and rich-text lists', () => {
  assert.deepEqual(REVIEWED_GLOBS, [...DEPENDENCY_PATHS, PACKAGE_MANIFESTS, ...RICHTEXT_PATHS]);
  for (const p of ['.npmrc', 'pnpm-lock.yaml', '.pnpmfile.cjs', 'package.json5'])
    assert.ok(
      REVIEWED_GLOBS.some((g) => expandBraces(g).includes(p)),
      p,
    );
});

test('every reviewed glob compiles (no unsupported "**" placement)', () => {
  for (const g of REVIEWED_GLOBS) assert.ok(compileGlob(g).length >= 1, g);
  assert.throws(() => compileGlob('a/**/b'), /"\*\*" before its last segment/);
});

test('expandBraces expands every group', () => {
  assert.deepEqual(expandBraces('p/package.{yaml,json5}'), ['p/package.yaml', 'p/package.json5']);
  assert.deepEqual(expandBraces('{a,b}/{c,d}'), ['a/c', 'a/d', 'b/c', 'b/d']);
  assert.deepEqual(expandBraces('x'), ['x']);
});

// ---- good fixtures ----

test('ordinary paths pass, including non-ASCII NFC names and dotfiles', () => {
  assert.deepEqual(
    rules([
      '.npmrc',
      'pnpm-lock.yaml',
      'package.json',
      'packages/ui/package.json',
      'packages/UI-Kit/package.json', // the package folder is a wildcard segment
      'packages/core/src/richtext/render.ts',
      'scripts/test/RichText-a.test.mjs', // wildcard segment, already reviewed nocase
      'docs/README.md',
      'tenants/caf\u00e9/content/menu.yaml', // NFC \u00e9
      'tenants/roma/content/Pizza.md',
      '.github/workflows/ci.yml',
      'a.b/c.d',
    ]),
    [],
  );
});

test('the repository itself passes', () => {
  const paths = gitPaths(ROOT);
  assert.ok(paths.length > 10 && paths.includes('package.json'));
  assert.deepEqual(rules(paths), []);
});

// ---- case ----

test('case: a case variant of a reviewed dependency path is refused', () => {
  for (const p of [
    '.NPMRC',
    'PNPM-LOCK.yaml',
    'Package.json',
    '.PNPMFILE.cjs',
    'package.YAML',
    'Playground/package.json',
    'playground/Package.json',
    'packages/ui/PACKAGE.json',
    'Packages/ui/package.json',
    'packages/ui/package.JSON5',
  ])
    assert.deepEqual(rules([p]), [`${p} case-alias`], p);
});

test('case: a case variant of a rich-text path is refused', () => {
  assert.deepEqual(rules(['packages/core/src/RichText/render.ts']), [
    'packages/core/src/RichText/render.ts case-alias',
  ]);
  assert.deepEqual(rules(['Scripts/check-boundaries.mjs']), [
    'Scripts/check-boundaries.mjs case-alias',
  ]);
  assert.deepEqual(rules(['packages/core/Package.json']), [
    'packages/core/Package.json case-alias',
  ]);
});

test('case: a non-ASCII fold (Kelvin sign, long s) still counts as a case variant', () => {
  // U+212A KELVIN SIGN folds to "k"; U+017F LONG S folds to "s".
  // The Kelvin sign is also not NFC (it normalises to "K"), so it is refused twice over.
  assert.deepEqual(rulesOf(['pac\u212aage.json']), ['case-alias', 'not-nfc']);
  assert.deepEqual(rulesOf(['.pnpmfile.cj\u017f']), ['case-alias']);
});

test('case: two tracked files that differ only by case are both refused', () => {
  assert.deepEqual(rules(['docs/a.md', 'docs/A.md']).sort(), [
    'docs/A.md case-collision',
    'docs/a.md case-collision',
  ]);
});

test('case: folders that differ only by case collide, and so do a file and a folder', () => {
  assert.deepEqual(rules(['docs/a.md', 'Docs/b.md']).sort(), [
    'Docs case-collision',
    'docs case-collision',
  ]);
  assert.deepEqual(rules(['readme', 'README/x.md']).sort(), [
    'README case-collision',
    'readme case-collision',
  ]);
});

test('case: the collision message names the other spelling', () => {
  const [p] = checkPaths(['x/Y', 'x/y']);
  assert.match(p.message, /same path as "x\/y"/);
});

test('caseAliasOf only flags literal segments', () => {
  const c = REVIEWED_GLOBS.flatMap(compileGlob);
  assert.equal(caseAliasOf('packages/Foo/package.json', c), null);
  assert.equal(caseAliasOf('packages/foo/Package.json', c), 'packages/*/package.json');
  assert.equal(caseAliasOf('packages/foo/bar/package.json', c), null);
  assert.equal(caseAliasOf('package.json', c), null);
  assert.equal(caseAliasOf('packages/core/src/richtext', c), null); // "**" needs one more segment
});

// ---- trailing dot or space (Windows) ----

test('trailing dot or space: refused in any segment', () => {
  for (const p of ['.npmrc.', '.npmrc ', 'package.json...', 'docs./a.md', 'docs /a.md', 'a/b. '])
    assert.ok(rulesOf([p]).includes('trailing-dot-space'), p);
  // Reported once, on the folder, not again on every file below it.
  assert.deepEqual(rules(['docs./a.md', 'docs./b.md']), ['docs. trailing-dot-space']);
});

test('trailing dot or space: dots and spaces elsewhere are fine', () => {
  assert.deepEqual(rules(['.github/x', 'a b/c d.md', 'v1.2.3/x', '..x/y']), []);
});

// ---- Unicode normalisation (macOS) ----

test('NFC: an NFD name is refused, the NFC spelling passes', () => {
  const nfd = 'tenants/cafe\u0301/menu.yaml';
  assert.deepEqual(rules([nfd]), ['tenants/cafe\u0301 not-nfc']);
  assert.deepEqual(rules([nfd.normalize('NFC')]), []);
});

test('NFC: an NFD spelling of a reviewed path is refused too', () => {
  // "pa\u0301ckage.json" is not package.json, but an NFD name of any reviewed file is refused.
  assert.deepEqual(rulesOf(['packages/core/src/richte\u0301xt/a.ts']), ['not-nfc']);
});

test('NFC and NFD spellings of one name collide', () => {
  const nfc = 'docs/caf\u00e9.md';
  const nfd = 'docs/cafe\u0301.md';
  assert.deepEqual(rulesOf([nfc, nfd]), ['case-collision', 'not-nfc']);
});

// ---- ignorable and control code points (HFS+) ----

test('ignorable: the security-30 code points are refused, alone and next to a reviewed name', () => {
  for (const cp of [0x200b, 0x200c, 0x200d, 0x2060, 0xfeff]) {
    const c = String.fromCodePoint(cp);
    for (const p of [`pnpm-lock.yaml${c}`, `${c}.npmrc`, `pack${c}age.json`, `docs${c}/a.md`]) {
      const got = checkPaths([p]);
      assert.ok(
        got.some((x) => x.rule === 'ignorable'),
        `${p}: ${JSON.stringify(got)}`,
      );
      const hexCp = cp.toString(16).toUpperCase().padStart(4, '0');
      assert.ok(got.find((x) => x.rule === 'ignorable').message.includes(`U+${hexCp}`));
    }
  }
});

test('ignorable: the rest of HFS+ ignore list and other default-ignorables are refused', () => {
  const cps = [
    0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x206a, 0x206f, 0x00ad, 0x034f, 0x180e,
    0xfe0f, 0xe0001, 0xe0100,
  ];
  for (const cp of cps)
    assert.ok(rulesOf([`a${String.fromCodePoint(cp)}b`]).includes('ignorable'), cp.toString(16));
});

test('control characters are refused', () => {
  for (const c of ['\t', '\n', '\r', '\u0001', '\u007f', '\u0085'])
    assert.ok(rulesOf([`a${c}b`]).includes('control'), JSON.stringify(c));
});

test('invalid UTF-8 from git is refused', () => {
  const buf = Buffer.concat([
    Buffer.from('ok.md\0'),
    Buffer.from([0x61, 0xff, 0x62]),
    Buffer.from('\0'),
  ]);
  const paths = splitNul(buf);
  assert.equal(paths.length, 2);
  assert.deepEqual(rulesOf(paths), ['invalid-utf8']);
});

test('a segment longer than any filesystem allows is refused', () => {
  assert.deepEqual(rulesOf(['a'.repeat(MAX_SEGMENT_BYTES)]), []);
  assert.deepEqual(rulesOf(['a'.repeat(MAX_SEGMENT_BYTES + 1)]), ['too-long']);
  assert.deepEqual(rulesOf([`${'a/'.repeat(2100)}x`]), ['too-long']);
});

// ---- helpers ----

test('entriesOf lists every folder prefix once', () => {
  assert.deepEqual(entriesOf(['a/b/c', 'a/b/d', 'e']).sort(), ['a', 'a/b', 'a/b/c', 'a/b/d', 'e']);
});

test('gitPaths reads raw names from git, without quoting', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pwp-alias-'));
  const git = (...args) => {
    const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  };
  git('init', '-q');
  writeFileSync(join(dir, '.npmrc '), '');
  writeFileSync(join(dir, 'caf\u00e9.md'), '');
  mkdirSync(join(dir, 'd'));
  writeFileSync(join(dir, 'd', 'x\u200c'), '');
  git('add', '-A');
  const paths = gitPaths(dir).sort();
  assert.deepEqual(paths, ['.npmrc ', 'caf\u00e9.md', 'd/x\u200c']);
  assert.deepEqual(rulesOf(paths), ['ignorable', 'trailing-dot-space']);
});

test('treePaths fails closed on a truncated or malformed listing, or a bad sha', async () => {
  const sha = 'a'.repeat(40);
  const ok = await treePaths('o/r', sha, async () => ({
    truncated: false,
    tree: [{ path: 'a' }, { path: 'a/b' }],
  }));
  assert.deepEqual(ok, ['a', 'a/b']);
  await assert.rejects(
    treePaths('o/r', sha, async () => ({ truncated: true, tree: [] })),
    /truncated/,
  );
  await assert.rejects(
    treePaths('o/r', sha, async () => ({ tree: [] })),
    /truncated/,
  );
  await assert.rejects(
    treePaths('o/r', sha, async () => ({})),
    /no "tree" list/,
  );
  await assert.rejects(
    treePaths('o/r', 'main', async () => ({})),
    /not a commit sha/,
  );
});

// ---- ReDoS: every rule stays linear on hostile input ----

test('long hostile paths are checked in linear time', () => {
  const n = 200_000;
  const inputs = [
    `${'a'.repeat(n)}html-sin`, // near miss for scripts/test/*html-sink*
    `scripts/test/${'*'.repeat(n)}`,
    `scripts/test/${'richtext-'.repeat(n / 9)}`,
    `${'.'.repeat(n)}x`,
    `${' '.repeat(n)}x`,
    `${'e\u0301'.repeat(n / 2)}`,
    `${'\u200c'.repeat(n)}x`,
    Array.from({ length: 20_000 }, (_, i) => `d${i}`).join('/'), // over MAX_PATH_BYTES
    `${'d/'.repeat(2047)}x`, // the deepest path under the limit
  ];
  for (const p of inputs) {
    const start = Date.now();
    checkPaths([p]);
    assert.ok(Date.now() - start < 2000, `${p.slice(0, 20)}… took ${Date.now() - start} ms`);
  }
  // Many files: the collision map is linear in the number of entries.
  const many = Array.from({ length: 50_000 }, (_, i) => `packages/p${i % 100}/src/f${i}.ts`);
  const start = Date.now();
  assert.deepEqual(checkPaths(many), []);
  assert.ok(Date.now() - start < 5000, `50k paths took ${Date.now() - start} ms`);
});

// ---- the pr-gates.yml step ----

const WORKFLOW = readFileSync(join(ROOT, '.github/workflows/pr-gates.yml'), 'utf8');

/** The text of one job: from `  <id>:` to the next top-level job key. */
function jobText(id) {
  const lines = WORKFLOW.split('\n');
  const start = lines.indexOf(`  ${id}:`);
  assert.ok(start >= 0, `job ${id} exists`);
  const end = lines.findIndex((l, i) => i > start && /^ {2}[A-Za-z0-9_-]+:/.test(l));
  return lines.slice(start, end === -1 ? undefined : end).join('\n');
}

test('workflow: the path-aliases job runs the base copy and never checks out the PR head', () => {
  const job = jobText('path-aliases');
  assert.match(job, /ref: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/);
  assert.doesNotMatch(job, /head\.ref|ref: \$\{\{ github\.event\.pull_request\.head/);
  assert.match(job, /persist-credentials: false/);
  assert.match(job, /working-directory: base-gate/);
  assert.match(job, /HEAD_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  assert.match(WORKFLOW, /^on:\n {2}pull_request:/m);
  assert.doesNotMatch(WORKFLOW, /^\s*pull_request_target:/m);
  assert.match(WORKFLOW, /^permissions:\n {2}contents: read\n/m);
});

/** The `run:` command of the path-aliases step, as written in the workflow. */
function stepCommand() {
  const m = /^ {8}run: (node scripts\/check-path-aliases\.mjs .*)$/m.exec(jobText('path-aliases'));
  assert.ok(m, 'path-aliases step has a one-line run command');
  return m[1];
}

/** Runs the workflow step against a fake trees API that serves `paths` for HEAD_SHA. */
async function runStep(paths, { truncated = false, status = 200 } = {}) {
  const sha = 'b'.repeat(40);
  const seen = [];
  const server = createServer((req, res) => {
    seen.push({ url: req.url, auth: req.headers.authorization });
    if (status !== 200 || req.url !== `/repos/o/r/git/trees/${sha}?recursive=1`) {
      res.writeHead(status === 200 ? 404 : status).end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ sha, truncated, tree: paths.map((path) => ({ path })) }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  const child = spawn('bash', ['-c', stepCommand()], {
    cwd: ROOT, // stands in for base-gate: the same scripts/ folder
    env: {
      PATH: process.env.PATH,
      HEAD_SHA: sha,
      GITHUB_TOKEN: 'fake-token',
      GITHUB_REPOSITORY: 'o/r',
      GITHUB_API_URL: `http://127.0.0.1:${port}`,
    },
  });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  const code = await new Promise((r) => child.on('close', r));
  server.close();
  return { code, out, seen };
}

test('workflow step: passes on a good tree', async () => {
  const r = await runStep(['package.json', 'docs', 'docs/a.md', 'packages/ui/package.json']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /check-path-aliases: OK/);
  assert.deepEqual(r.seen, [
    { url: `/repos/o/r/git/trees/${'b'.repeat(40)}?recursive=1`, auth: 'Bearer fake-token' },
  ]);
});

test('workflow step: fails on each bad fixture and names the path and rule', async () => {
  for (const [path, rule] of [
    ['.NPMRC', 'case-alias'],
    ['.npmrc.', 'trailing-dot-space'],
    ['.npmrc ', 'trailing-dot-space'],
    ['pnpm-lock.yaml\u200c', 'ignorable'],
    ['cafe\u0301.md', 'not-nfc'],
  ]) {
    const r = await runStep(['package.json', path]);
    assert.equal(r.code, 1, `${JSON.stringify(path)}: ${r.out}`);
    assert.ok(r.out.includes(`${JSON.stringify(path)} [${rule}]`), r.out);
  }
});

test('workflow step: fails closed on a truncated tree and on an API error', async () => {
  const t = await runStep(['package.json'], { truncated: true });
  assert.equal(t.code, 1);
  assert.match(t.out, /truncated/);
  const e = await runStep(['package.json'], { status: 500 });
  assert.equal(e.code, 1);
  assert.match(e.out, /GitHub API .*: 500/);
});
