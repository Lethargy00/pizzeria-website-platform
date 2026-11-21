// #129: bootstrap-lockfile must not run dependency or branch code next to a write token.
// Dependency-free: the workflow is read as text with a small indentation-based splitter
// (enough for this file's block style), and the push job's verify script is extracted and run
// with bash + git against good and bad patch fixtures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORKFLOW = readFileSync(join(ROOT, '.github/workflows/bootstrap-lockfile.yml'), 'utf8');
const LINES = WORKFLOW.split('\n');

// Child blocks of a mapping: lines at exactly `indent` spaces that look like `key:` start a block.
function children(lines, indent) {
  const out = new Map();
  let key = null;
  const head = new RegExp(`^ {${indent}}([A-Za-z0-9_-]+):(.*)$`);
  for (const line of lines) {
    const m = head.exec(line);
    if (m) {
      key = m[1];
      out.set(key, [line]);
    } else if (key && (line.startsWith(' '.repeat(indent + 1)) || line.trim() === '')) {
      out.get(key).push(line);
    } else if (key && !line.startsWith('#') && line.trim() && !/^\s*#/.test(line)) {
      key = null;
    }
  }
  return out;
}

const top = children(LINES, 0);
const jobs = children(top.get('jobs'), 2);
const jobText = (id) => jobs.get(id).join('\n');
function steps(id) {
  const out = [];
  for (const line of jobs.get(id)) {
    if (/^ {6}- /.test(line)) out.push([line]);
    else if (out.length && (/^ {8}/.test(line) || line.trim() === '')) out.at(-1).push(line);
  }
  return out.map((s) => s.join('\n'));
}
// The literal `run: |` script of a step, dedented.
function runScript(step) {
  const lines = step.split('\n');
  const i = lines.findIndex((l) => /^\s+run: \|\s*$/.test(l));
  assert.ok(i >= 0, 'step has a run: | block');
  const indent = lines[i].search(/\S/) + 2;
  const body = [];
  for (const l of lines.slice(i + 1)) {
    if (l.trim() && l.search(/\S/) < indent) break;
    body.push(l.slice(indent));
  }
  return body.join('\n');
}
// Workflow-level env value (single-quoted YAML scalar).
function topEnv(name) {
  const line = top.get('env').find((l) => l.trimStart().startsWith(`${name}:`));
  const m = /:\s*'((?:[^']|'')*)'\s*$/.exec(line ?? '');
  assert.ok(m, `env ${name} is a single-quoted scalar`);
  return m[1].replaceAll("''", "'");
}

test('jobs: generate (read-only) then push (write)', () => {
  assert.deepEqual([...jobs.keys()], ['generate', 'push']);
  assert.match(jobText('push'), /^ {4}needs: generate$/m);
});

test('no privileged triggers; default token is read-only', () => {
  assert.doesNotMatch(WORKFLOW, /pull_request_target|workflow_run|issue_comment/);
  assert.deepEqual(
    top.get('permissions').map((l) => l.trim()),
    ['permissions:', 'contents: read'],
  );
});

test('every job only runs for refs/heads/main', () => {
  for (const id of jobs.keys()) {
    const m = new RegExp(`^ {4}if: (.*)$`, 'm').exec(jobText(id));
    assert.ok(m, `${id} has a job-level if`);
    // The ref check must be a top-level conjunct, not hidden behind an ||.
    assert.match(m[1], /^github\.ref == 'refs\/heads\/main'( && [^|]+)?$/, `${id}: ${m[1]}`);
  }
});

test('generate: contents read only, no persisted or referenced token', () => {
  const t = jobText('generate');
  const perms = children(jobs.get('generate'), 4).get('permissions');
  assert.deepEqual(perms.map((l) => l.trim()).filter(Boolean), ['permissions:', 'contents: read']);
  assert.doesNotMatch(t, /secrets\.|github\.token|GH_TOKEN|GITHUB_TOKEN/);
  assert.doesNotMatch(t, /git push|gh workflow/);
});

test('push: write permissions, runs no repo or dependency code', () => {
  const t = jobText('push');
  const perms = children(jobs.get('push'), 4).get('permissions');
  assert.deepEqual(perms.map((l) => l.trim()).filter(Boolean), [
    'permissions:',
    'contents: write',
    'actions: write',
  ]);
  const uses = [...t.matchAll(/uses: ([^\s@]+)@/g)].map((m) => m[1]);
  assert.deepEqual(uses, ['actions/checkout', 'actions/download-artifact']);
  for (const step of steps('push').filter((s) => /run: \|/.test(s))) {
    const script = runScript(step);
    // Commands only: drop quoted strings (messages, annotations) and comments first.
    const code = script
      .replace(/"[^"\n]*"|'[^'\n]*'/g, '""')
      .replace(/(^|\s)#.*$/gm, '')
      .replaceAll('pnpm-lock.yaml', 'LOCKFILE');
    assert.doesNotMatch(
      code,
      /\b(pnpm|npm|npx|yarn|node|corepack|prettier|turbo|make|source)\b|(^|\s)(\.\/|bash |sh )/m,
      'push job must not run repo or dependency code',
    );
    // No expressions inside scripts (untrusted job outputs could inject shell).
    assert.doesNotMatch(script, /\$\{\{/);
  }
  assert.doesNotMatch(t, /cache:/);
});

test('every checkout sets persist-credentials: false', () => {
  const checkouts = [...WORKFLOW.matchAll(/uses: actions\/checkout@\S+\n\s+with: (\{.*\})$/gm)];
  const count = (WORKFLOW.match(/uses: actions\/checkout@/g) ?? []).length;
  assert.equal(count, 2);
  assert.equal(checkouts.length, count, 'each checkout has an inline with: {...}');
  for (const m of checkouts) assert.match(m[1], /persist-credentials: false/);
});

test('the write token appears only in the final push step, and is not written to git config', () => {
  const tokenSteps = [...jobs.keys()].flatMap((id) =>
    steps(id)
      .map((s, i) => ({ id, i, s }))
      .filter(({ s }) => /secrets\.GITHUB_TOKEN|github\.token/.test(s)),
  );
  assert.equal(tokenSteps.length, 1);
  const { id, i, s } = tokenSteps[0];
  assert.equal(id, 'push');
  assert.equal(i, steps('push').length - 1);
  const script = runScript(s);
  assert.doesNotMatch(script, /git (config|remote)[^\n]*(TOKEN|extraheader|url)/i);
  assert.match(script, /git push "https:\/\/x-access-token:\$\{GH_TOKEN\}@github\.com\//);
});

test('generate: every pnpm install runs with --ignore-scripts', () => {
  const installs = steps('generate')
    .filter((s) => /run: \|/.test(s))
    .flatMap((s) => runScript(s).split('\n'))
    .filter((l) => /\bpnpm (install|i|add)\b/.test(l));
  assert.equal(installs.length, 2, 'the staleness check and the regeneration');
  for (const l of installs) assert.match(l, /\bpnpm install\b[^|;&]*\s--ignore-scripts\b/, l);
  assert.doesNotMatch(jobText('generate'), /\b(pnpm|npm) (rebuild|run|exec)\b|\bnpx\b/);
});

test('the uploaded and downloaded artifact names match', () => {
  const name = (id, action) => {
    const step = steps(id).find((s) => s.includes(`uses: actions/${action}@`));
    assert.ok(step, `${id} uses ${action}`);
    const m = /^\s+name: (\S+)\s*$/m.exec(step);
    assert.ok(m, `${action} step names its artifact`);
    return m[1];
  };
  assert.equal(name('generate', 'upload-artifact'), 'bootstrap-patch');
  assert.equal(name('push', 'download-artifact'), name('generate', 'upload-artifact'));
});

test('push: applies the patch as binary and dispatches ci and security after pushing', () => {
  const verifyScript = runScript(steps('push').find((s) => /^ {6}- id: verify$/m.test(s)));
  assert.match(verifyScript, /^git apply --index --binary\b/m);
  const last = runScript(steps('push').at(-1)).split('\n');
  const at = (re) => last.findIndex((l) => re.test(l));
  const push = at(/^git push /);
  assert.ok(push >= 0, 'pushes');
  for (const wf of ['ci', 'security']) {
    const i = at(new RegExp(`^gh workflow run ${wf}\\.yml --ref main$`));
    assert.ok(i > push, `dispatches ${wf}.yml after the push`);
  }
});

// ---- allow-list vs review matrix (drift) ----

// Every path that review-gate sends to architect, dependency, security or richtext review must be
// one the push job refuses. Checked for every tracked file and for one sample per matrix glob, so
// a path added to the matrix (or a file added to the repo) that PROTECTED_PATHS misses fails CI.
const REVIEWED_ROWS = ['architect', 'dependency', 'security', 'richtext'];
const MATRIX_SAMPLES = [
  // security row
  'packages/functions/src/order.ts',
  'packages/adapters/src/stripe/index.ts',
  'packages/ui/src/components/ContactForm/ContactForm.astro',
  'packages/ui/src/sanitize/index.ts',
  'packages/core/src/sanitizer.ts',
  'packages/core/src/csp/policy.ts',
  'packages/core/src/build-csp.ts',
  'packages/core/src/headers/index.ts',
  'packages/cli/src/build/index.ts',
  'packages/cli/src/isolation/index.ts',
  '.github/workflows/ci.yml',
  'scripts/tenant-guard.mjs',
  'scripts/review-gate.mjs',
  'scripts/touches-guard.mjs',
  'scripts/new-guard.mjs',
  'scripts/lib/glob.mjs',
  'scripts/check-licenses.mjs',
  'packages/adapters/.env.example',
  'SECURITY.md',
  'docs/SECURITY.md',
  'docs/THREAT-MODEL.md',
  '.github/CODEOWNERS',
  // richtext row
  'packages/core/src/richtext/render.ts',
  'packages/core/src/richtext/safe-html.ts',
  'packages/core/src/richtext/schema.ts',
  'packages/core/src/richtext/index.ts',
  'packages/core/package.json',
  'scripts/boundaries.json',
  'scripts/check-boundaries.mjs',
  'scripts/check-html-sinks.mjs',
  'scripts/test/richtext-render.test.mjs',
  'scripts/test/check-html-sink.test.mjs',
  // architect row
  'packages/schema/src/menu/menu.ts',
  'packages/ui/src/contracts/hero.ts',
  'packages/adapters/src/interfaces/content.ts',
  'docs/adr/0001-example.md',
  'packages/ui/package.json',
  'packages/ui/package.yaml',
  'packages/ui/package.json5',
  // dependency row
  'package.json',
  'package.yaml',
  'playground/package.json',
  'playground/package.json5',
  'pnpm-workspace.yaml',
  '.npmrc',
  '.pnpmfile.cjs',
  '.pnpmfile.mjs',
];

test('allow-list: every path review-gate sends to a non-peer reviewer is refused', async () => {
  const { MATRIX } = await import('../review-gate.mjs');
  const rows = MATRIX.filter((r) => REVIEWED_ROWS.includes(r.id));
  assert.equal(rows.length, REVIEWED_ROWS.length, 'all reviewed rows still exist');
  const reviewed = (f) => rows.some((r) => r.when(f, [], {}));
  const format = new RegExp(topEnv('FORMAT_PATHS'));
  const protectedRe = new RegExp(topEnv('PROTECTED_PATHS'));
  const allowedByVerify = (f) => format.test(f) && !protectedRe.test(f);

  for (const f of MATRIX_SAMPLES) assert.ok(reviewed(f), `sample ${f} no longer hits the matrix`);
  const ls = spawnSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' });
  const tracked = ls.status === 0 ? ls.stdout.split('\0').filter(Boolean) : [];
  assert.ok(tracked.length > 0, 'git ls-files works in the checkout');

  const leaks = [...new Set([...MATRIX_SAMPLES, ...tracked])]
    .filter((f) => f !== 'pnpm-lock.yaml') // the one reviewed path the job exists to write
    .filter((f) => reviewed(f) && allowedByVerify(f));
  assert.deepEqual(leaks, [], 'reviewed paths that the push job would accept');
});

// ---- verify script, run for real against fixtures ----

const verifyStep = steps('push').find((s) => /^ {6}- id: verify$/m.test(s));
const VERIFY = runScript(verifyStep);
const ENV_NAMES = [
  'FORMAT_PATHS',
  'PROTECTED_PATHS',
  'CODE_PATHS',
  'LOCK_TARBALL',
  'LOCK_SPECIAL',
  'LOCK_FORM',
  'LOCK_DEPRECATED',
];
const ENV = Object.fromEntries(ENV_NAMES.map((n) => [n, topEnv(n)]));

const git = (cwd, ...args) => {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
    cwd,
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
};
const put = (root, rel, text) => {
  mkdirSync(join(root, rel, '..'), { recursive: true });
  writeFileSync(join(root, rel), text);
};

const BASE = {
  'pnpm-lock.yaml': "lockfileVersion: '9.0'\n",
  'package.json': '{ "name": "x" }\n',
  '.npmrc': 'save-exact=true\n',
  '.github/workflows/ci.yml': 'name: ci\n',
  'scripts/review-gate.mjs': 'export {};\n',
  'docs/GUIDE.md': '# Guide\n',
  'docs/SECURITY.md': '# Security\n',
  'packages/ui/src/a.ts': "export const a = 'a';\n",
  'packages/ui/src/styles.css': 'a { color: red }\n',
  'packages/cli/src/b.ts': 'export {};\n',
  'packages/ui/src/sanitize.ts': 'export {};\n',
  'tenants/demo/site.json': '{}\n',
  'eslint.config.js': 'export default [];\n',
  'docs/notes.txt': 'notes\n',
  'packages/ui/package.yaml': 'name: ui\n',
  'packages/core/src/richtext/render.ts': 'export const render = 1;\n',
  'packages/ui/src/contracts/hero.ts': 'export {};\n',
};

// Builds a repo from BASE (minus `omit`), applies `change`, turns it into a patch, resets, then
// runs the workflow's verify script. Returns the bash result.
function verify(change, { omit = [], base = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pwp-bootstrap-'));
  try {
    const repo = join(dir, 'repo');
    mkdirSync(repo);
    git(repo, 'init', '-q');
    for (const [rel, text] of Object.entries({ ...BASE, ...base }))
      if (!omit.includes(rel)) put(repo, rel, text);
    git(repo, 'add', '-A');
    git(repo, 'commit', '-qm', 'base');
    change(repo);
    git(repo, 'add', '-A');
    const patch = git(repo, 'diff', '--cached', '--binary', '--no-renames', 'HEAD');
    git(repo, 'reset', '-q', '--hard', 'HEAD');
    git(repo, 'clean', '-qfdx');
    const PATCH = join(dir, 'bootstrap.patch');
    writeFileSync(PATCH, patch);
    return spawnSync('bash', ['-c', VERIFY], {
      cwd: repo,
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: dir, GIT_CONFIG_NOSYSTEM: '1', PATCH, ...ENV },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const ok = (r) => assert.equal(r.status, 0, r.stdout + r.stderr);
const rejected = (r, re = /outside the allow-list/) => {
  assert.notEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout + r.stderr, re);
};

test('verify: accepts lockfile changes and formatting of ordinary files', () => {
  ok(verify((r) => put(r, 'pnpm-lock.yaml', "lockfileVersion: '9.0'\nimporters: {}\n")));
  ok(
    verify((r) => put(r, 'pnpm-lock.yaml', "lockfileVersion: '9.0'\n"), {
      omit: ['pnpm-lock.yaml'],
    }),
  );
  ok(
    verify((r) => {
      put(r, 'pnpm-lock.yaml', "lockfileVersion: '9.0'\nimporters: {}\n");
      put(r, 'docs/GUIDE.md', '# Guide\n\nText\n');
      put(r, 'packages/ui/src/styles.css', 'a {\n  color: red;\n}\n');
    }),
  );
});

test('verify: rejects protected, new, deleted, mode-changed and symlinked paths', () => {
  const cases = {
    workflow: (r) => put(r, '.github/workflows/ci.yml', 'name: ci\non: push\n'),
    npmrc: (r) => put(r, '.npmrc', 'save-exact=false\n'),
    'package.json': (r) => put(r, 'package.json', '{ "name": "y" }\n'),
    'package.yaml manifest': (r) => put(r, 'packages/ui/package.yaml', 'name: evil\n'),
    'gate script': (r) => put(r, 'scripts/review-gate.mjs', 'process.exit(0);\n'),
    'security doc': (r) => put(r, 'docs/SECURITY.md', '# none\n'),
    'cli package': (r) => put(r, 'packages/cli/src/b.ts', 'export const b = 1;\n'),
    'richtext chokepoint': (r) =>
      put(r, 'packages/core/src/richtext/render.ts', 'export const render = 2;\n'),
    'package contract': (r) => put(r, 'packages/ui/src/contracts/hero.ts', 'export const h = 1;\n'),
    'sanitizer path': (r) => put(r, 'packages/ui/src/sanitize.ts', 'export const s = 1;\n'),
    tenant: (r) => put(r, 'tenants/demo/site.json', '{ "x": 1 }\n'),
    'tool config': (r) => put(r, 'eslint.config.js', 'export default [{}];\n'),
    'new .pnpmfile.cjs': (r) => put(r, '.pnpmfile.cjs', 'module.exports = {};\n'),
    'new source file': (r) => put(r, 'packages/ui/src/evil.ts', 'export {};\n'),
    'deleted file': (r) => rmSync(join(r, 'docs/GUIDE.md')),
    'mode change': (r) => spawnSync('chmod', ['+x', join(r, 'docs/GUIDE.md')]),
    'lockfile symlink': (r) => {
      rmSync(join(r, 'pnpm-lock.yaml'));
      symlinkSync('/etc/passwd', join(r, 'pnpm-lock.yaml'));
    },
    'new non-format file': (r) => put(r, 'docs/new.txt', 'x\n'),
    'modified non-format file': (r) => put(r, 'docs/notes.txt', 'changed\n'),
  };
  for (const [name, change] of Object.entries(cases)) {
    const r = verify((repo) => {
      put(repo, 'pnpm-lock.yaml', "lockfileVersion: '9.0'\nimporters: {}\n");
      change(repo);
    });
    assert.notEqual(r.status, 0, `${name} should be rejected:\n${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /outside the allow-list|code file changed/, name);
  }
  // FORMAT_PATHS on its own: an existing, unprotected, mode-100644 file without a Prettier
  // extension may not be modified, even without a lockfile change alongside.
  rejected(verify((r) => put(r, 'docs/notes.txt', 'changed\n')));
});

test('verify: a patch that does not apply is rejected', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pwp-bootstrap-'));
  try {
    git(dir, 'init', '-q');
    put(dir, 'docs/GUIDE.md', '# Guide\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'base');
    const PATCH = join(dir, '..', `${dir.split('/').at(-1)}.patch`);
    writeFileSync(
      PATCH,
      'diff --git a/../outside b/../outside\nnew file mode 100644\n--- /dev/null\n+++ b/../outside\n@@ -0,0 +1 @@\n+x\n',
    );
    const r = spawnSync('bash', ['-c', VERIFY], {
      cwd: dir,
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: dir, GIT_CONFIG_NOSYSTEM: '1', PATCH, ...ENV },
    });
    rmSync(PATCH, { force: true });
    rejected(r, /does not apply/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- #177: code files are never auto-pushed ----

test('verify: a formatting change to any code file fails the run instead of being pushed', () => {
  const code = [
    'packages/ui/src/a.ts',
    'packages/ui/src/b.tsx',
    'packages/ui/src/c.mts',
    'packages/ui/src/d.cts',
    'packages/ui/src/e.js',
    'packages/ui/src/f.jsx',
    'packages/ui/src/g.mjs',
    'packages/ui/src/h.cjs',
    'packages/ui/src/Card.astro',
    'packages/ui/src/i.mdx',
    'playground/index.html',
    'playground/legacy.htm',
    'packages/ui/src/j.vue',
    'packages/ui/src/k.svelte',
  ];
  const base = Object.fromEntries(code.map((f) => [f, 'x\n']));
  for (const f of code) {
    const r = verify((repo) => put(repo, f, 'y\n'), { base });
    assert.notEqual(r.status, 0, `${f} should fail:\n${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /code file changed \(status M\)/, f);
  }
  // FORMAT_PATHS itself lists no code extension, so CODE_PATHS is not the only thing in the way.
  const format = new RegExp(topEnv('FORMAT_PATHS'));
  for (const f of code) assert.ok(!format.test(f), `FORMAT_PATHS matches ${f}`);
});

// ---- #177: lockfile content ----

const LOCK_BASE = `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false

importers:

  .:
    devDependencies:
      prettier:
        specifier: 3.6.2
        version: 3.6.2

  packages/ui:
    dependencies:
      '@pwp/core':
        specifier: workspace:*
        version: link:../core

packages:

  prettier@3.6.2:
    resolution: {integrity: sha512-AAAA==}
    engines: {node: '>=14'}
    hasBin: true

snapshots:

  prettier@3.6.2: {}
`;
// The base lockfile with `edit` applied (a [from, to] pair, or a function of the text), as a
// lockfile-only patch.
const lockVerify = (edit, base = LOCK_BASE) => {
  const next = typeof edit === 'function' ? edit(base) : base.replace(edit[0], edit[1]);
  assert.notEqual(next, base, 'the fixture edit changes the lockfile');
  return verify((r) => put(r, 'pnpm-lock.yaml', next), { base: { 'pnpm-lock.yaml': base } });
};
const addPackage = (entry) => (t) => t.replace('\nsnapshots:', `\n${entry}\nsnapshots:`);
const lockRejected = (r, name, re) => {
  assert.notEqual(r.status, 0, `${name} should be rejected:\n${r.stdout}${r.stderr}`);
  assert.match(r.stdout, re, name);
};

test('verify: accepts a lockfile-only patch with registry packages and existing workspace links', () => {
  const added = [
    '  rimraf@3.0.2:',
    '    resolution: {integrity: sha512-BBBB==}',
    "    deprecated: Rimraf versions prior to v4 aren't supported, see https://github.com/isaacs/rimraf",
    '    hasBin: true',
    '',
    '  left-pad@1.3.0:',
    '    resolution: {integrity: sha512-CCCC==, tarball: https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz}',
    '',
  ].join('\n');
  ok(
    lockVerify((t) =>
      addPackage(added)(t).replace(
        '        version: 3.6.2\n',
        '        version: 3.6.2\n      rimraf:\n        specifier: 3.0.2\n        version: 3.0.2\n',
      ),
    ),
  );
  // Removing an entry, including a link, is fine.
  ok(
    lockVerify([
      "      '@pwp/core':\n        specifier: workspace:*\n        version: link:../core\n",
      '',
    ]),
  );
});

test('verify: the real lockfile on main passes the lockfile content checks', () => {
  const real = readFileSync(join(ROOT, 'pnpm-lock.yaml'), 'utf8');
  ok(lockVerify((t) => `${t}\n`, real));
  ok(
    lockVerify(
      (t) =>
        t.replace(
          /\npackages:\n/,
          '\npackages:\n\n  zzz-new@1.0.0:\n    resolution: {integrity: sha512-ZZZZ==}\n',
        ),
      real,
    ),
  );
});

test('verify: rejects a tarball that is not on https://registry.npmjs.org/', () => {
  const re = /file=pnpm-lock\.yaml,line=\d+,.*tarball is not on https:\/\/registry\.npmjs\.org\//;
  const tarballs = {
    'other host': '{integrity: sha512-X==, tarball: https://evil.example/x.tgz}',
    'look-alike host': '{tarball: https://registry.npmjs.org.evil.example/x.tgz}',
    'userinfo host': '{tarball: https://registry.npmjs.org@evil.example/x.tgz}',
    port: '{tarball: https://registry.npmjs.org:8443/x.tgz}',
    'plain http': '{tarball: http://registry.npmjs.org/x/-/x-1.0.0.tgz}',
    'file tarball': '{tarball: file:vendor/x.tgz}',
    'quoted key': "{'tarball': https://evil.example/x.tgz}",
    'second tarball':
      '{tarball: https://registry.npmjs.org/x.tgz, tarball: https://evil.example/x.tgz}',
  };
  for (const [name, res] of Object.entries(tarballs)) {
    lockRejected(lockVerify(addPackage(`  x@1.0.0:\n    resolution: ${res}\n`)), name, re);
  }
  lockRejected(
    lockVerify(
      addPackage('  x@1.0.0:\n    resolution:\n      tarball: https://evil.example/x.tgz\n'),
    ),
    'block style',
    re,
  );
});

test('verify: rejects git, URL, file: and link: entries the base lockfile does not have', () => {
  const re =
    /file=pnpm-lock\.yaml,line=\d+,.*git, URL, file: or link: entry that the base lockfile does not have/;
  const cases = {
    'git resolution': addPackage(
      '  x@git+https://github.com/a/x.git#abc:\n    resolution: {commit: abc, repo: https://github.com/a/x.git, type: git}\n',
    ),
    'URL version': [
      '        version: 3.6.2\n',
      '        version: https://codeload.github.com/a/x/tar.gz/abc\n',
    ],
    'URL with another scheme': [
      '        version: 3.6.2\n',
      '        version: ftp://evil.example/x.tgz\n',
    ],
    'ssh: shorthand': ['        version: 3.6.2\n', '        version: ssh:evil.example/x\n'],
    'git+ssh: shorthand': ['        version: 3.6.2\n', '        version: git+ssh:evil.example/x\n'],
    'commit-only resolution': addPackage('  x@1.0.0:\n    resolution: {commit: abc}\n'),
    'github shorthand': ['        version: 3.6.2\n', '        version: github:a/x#abc\n'],
    'scp-style git': ['        version: 3.6.2\n', '        version: git@github.com:a/x.git\n'],
    'file: directory': addPackage(
      '  x@file:../evil:\n    resolution: {directory: ../evil, type: directory}\n',
    ),
    'file: version': ['        version: 3.6.2\n', '        version: file:../evil\n'],
    'new link:': ['version: link:../core', 'version: link:../../../evil'],
    'existing link moved to another importer': [
      '        version: 3.6.2\n',
      "        version: 3.6.2\n      '@pwp/core':\n        specifier: workspace:*\n        version: link:../core\n",
    ],
    'existing link copied into packages after a blank line': addPackage(
      "  packages/ui:\n    dependencies:\n      '@pwp/core':\n        specifier: workspace:*\n        version: link:../core\n",
    ),
    'URL in a field that is not a deprecation message': addPackage(
      '  x@1.0.0:\n    resolution: {integrity: sha512-X==}\n    homepage: https://evil.example\n',
    ),
  };
  for (const [name, edit] of Object.entries(cases)) lockRejected(lockVerify(edit), name, re);
});

test('verify: rejects lockfile YAML that could hide or move an entry from the line checks', () => {
  const form = /line=\d+,.*YAML anchor, alias, tag, merge key, document marker, explicit key/;
  const chars = /line=\d+,.*tab, carriage return, backslash escape or Unicode line break/;
  const expect = {
    // security-29 (#195): '"' has an even count of both quote characters, so only the
    // double-quote ban sees the open "..." that turns the next lines into fake parent keys.
    'double-quoted value spoofing parent keys':
      /line=\d+,.*double quote: pnpm writes single quotes/,
    'double-quoted value': /line=\d+,.*double quote: pnpm writes single quotes/,
    'multi-line flow mapping': /line=\d+,.*flow mapping spans lines/,
    'multi-line flow sequence': /line=\d+,.*flow sequence spans lines/,
    'multi-line quoted value': /line=\d+,.*quoted value spans lines/,
    'backslash escape': chars,
    'carriage return': chars,
    tab: chars,
    'Unicode line separator': chars,
  };
  const cases = {
    anchor: ['  packages/ui:\n', '  packages/ui: &ui\n'],
    alias: ['  .:\n    devDependencies:', '  .: *ui\n  x:\n    devDependencies:'],
    'merge key': ['    hasBin: true\n', '    hasBin: true\n    <<: {a: 1}\n'],
    tag: ['    hasBin: true\n', '    hasBin: !!bool true\n'],
    'multi-line flow mapping': [
      '    resolution: {integrity: sha512-AAAA==}\n',
      '    resolution: {integrity: sha512-AAAA==,\n      directory: ../evil}\n',
    ],
    'multi-line flow sequence': ['    hasBin: true\n', '    os: [linux,\n      darwin]\n'],
    'multi-line quoted value': [
      '        specifier: 3.6.2\n',
      "        specifier: '3.6.2\n  packages/ui:\n    x'\n",
    ],
    'backslash escape': ['    hasBin: true\n', '    "t\\x61rball": https://evil.example/x.tgz\n'],
    'carriage return': ['    hasBin: true\n', '    hasBin: true\r  packages/ui:\n'],
    tab: ['    hasBin: true\n', '    hasBin:\ttrue\n'],
    'Unicode line separator': ['    hasBin: true\n', '    hasBin: true\u2028  x: 1\n'],
    'double-quoted value spoofing parent keys': [
      '        specifier: 3.6.2\n        version: 3.6.2\n',
      [
        `        '"': "''`,
        '  packages/ui:',
        '    dependencies:',
        "      '@pwp/core':",
        '          x" # "',
        '        specifier: workspace:*',
        '        version: link:../core',
        '',
      ].join('\n'),
    ],
    'double-quoted value': ['        specifier: 3.6.2\n', '        specifier: "3.6.2"\n'],
    'block scalar': ['    hasBin: true\n', '    note: |\n      text\n'],
    'block scalar with a comment': [
      '        specifier: workspace:*\n',
      '        specifier: |- # c\n          workspace:*\n',
    ],
    'block scalar in a sequence with a comment': [
      '    hasBin: true\n',
      '    os:\n      - > # c\n        linux\n',
    ],
    'nested sequence block scalar': [
      '    hasBin: true\n',
      '    os:\n      - - |\n          linux\n',
    ],
    'document marker': ["lockfileVersion: '9.0'\n", "---\nlockfileVersion: '9.0'\n"],
    'explicit key': ['    hasBin: true\n', '    ? hasBin\n    : true\n'],
  };
  for (const [name, edit] of Object.entries(cases))
    lockRejected(lockVerify(edit), name, expect[name] ?? form);
});

test('verify: a lockfile that is new on main gets the same content checks', () => {
  rejected(
    verify(
      (repo) =>
        put(
          repo,
          'pnpm-lock.yaml',
          `${LOCK_BASE}\n  x@1.0.0:\n    resolution: {tarball: https://evil.example/x.tgz}\n`,
        ),
      { omit: ['pnpm-lock.yaml'] },
    ),
    /tarball is not on/,
  );
  // With no base lockfile, even a workspace link: is new.
  rejected(
    verify((repo) => put(repo, 'pnpm-lock.yaml', LOCK_BASE), { omit: ['pnpm-lock.yaml'] }),
    /entry that the base lockfile does not have \(under importers > packages\/ui > dependencies > '@pwp\/core'\): version: link:\.\.\/core/,
  );
});
