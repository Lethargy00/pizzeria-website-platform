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
  // A lockfile that is new on main has no base to compare lockfileVersion with (#217, R7).
  rejected(
    verify((r) => put(r, 'pnpm-lock.yaml', "lockfileVersion: '9.0'\n"), {
      omit: ['pnpm-lock.yaml'],
    }),
    /lockfileVersion differs from the base lockfile/,
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
// lockfile-only patch. `files` are other files at HEAD, such as the package.json whose change
// asked for the new lockfile.
const lockVerify = (edit, base = LOCK_BASE, files = {}) => {
  const next = typeof edit === 'function' ? edit(base) : base.replace(edit[0], edit[1]);
  assert.notEqual(next, base, 'the fixture edit changes the lockfile');
  return verify((r) => put(r, 'pnpm-lock.yaml', next), {
    base: { ...files, 'pnpm-lock.yaml': base },
  });
};
// A root package.json in the layout Prettier writes.
const pkgJson = (sections) => `${JSON.stringify({ name: 'x', ...sections }, null, 2)}\n`;
const addPackage = (entry) => (t) => t.replace('\nsnapshots:', `\n${entry}\nsnapshots:`);
const lockRejected = (r, name, re) => {
  assert.notEqual(r.status, 0, `${name} should be rejected:\n${r.stdout}${r.stderr}`);
  assert.match(r.stdout, re, name);
  // The peer-variant fixpoint always settles; its round cap is only a safeguard.
  assert.doesNotMatch(r.stdout, /peer variant check did not settle/, name);
};

test('verify: accepts a lockfile-only patch with registry packages and existing workspace links', () => {
  const added = [
    '  rimraf@3.0.2:',
    '    resolution: {integrity: sha512-BBBB==}',
    "    deprecated: Rimraf versions prior to v4 aren't supported, see https://github.com/isaacs/rimraf",
    '    hasBin: true',
    '',
    '  left-pad@1.3.0:',
    '    resolution: {integrity: sha512-CCCC==}',
    '',
  ].join('\n');
  // #196: rimraf is in package.json at HEAD, and left-pad is its dependency.
  const pj = pkgJson({ devDependencies: { prettier: '3.6.2', rimraf: '3.0.2' } });
  ok(
    lockVerify(
      (t) =>
        addPackage(added)(t)
          .replace(
            '        version: 3.6.2\n',
            '        version: 3.6.2\n      rimraf:\n        specifier: 3.0.2\n        version: 3.0.2\n',
          )
          .replace(
            '  prettier@3.6.2: {}\n',
            '  left-pad@1.3.0: {}\n\n  prettier@3.6.2: {}\n\n  rimraf@3.0.2:\n    dependencies:\n      left-pad: 1.3.0\n',
          ),
      LOCK_BASE,
      { 'package.json': pj },
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
  // A new direct dependency that the root package.json at HEAD asks for (#196).
  ok(
    lockVerify(
      (t) =>
        t
          .replace(
            '\n  .:\n    devDependencies:\n',
            '\n  .:\n    devDependencies:\n      aaa-new:\n        specifier: 1.0.0\n        version: 1.0.0\n',
          )
          .replace(
            /\npackages:\n/,
            '\npackages:\n\n  aaa-new@1.0.0:\n    resolution: {integrity: sha512-ZZZZ==}\n',
          )
          .replace(/\nsnapshots:\n/, '\nsnapshots:\n\n  aaa-new@1.0.0: {}\n'),
      real,
      { 'package.json': pkgJson({ devDependencies: { 'aaa-new': '1.0.0' } }) },
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
    /file=pnpm-lock\.yaml,line=\d+,.*git, URL, file:, link: or JSR entry that the base lockfile does not have/;
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
    'directive without a document marker': /line=1,.*top-level line that is not a key/,
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
    // qa-51 (#196): a %directive needs a --- marker, and is not a key on its own.
    'directive with a document marker': [
      "lockfileVersion: '9.0'\n",
      "%YAML 1.2\n---\nlockfileVersion: '9.0'\n",
    ],
    'directive without a document marker': [
      "lockfileVersion: '9.0'\n",
      "%YAML 1.2\nlockfileVersion: '9.0'\n",
    ],
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

// ---- #196: registry versions, integrity, aliases and JSR ----

const LOCK_GRAPH = `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false

importers:

  .:
    devDependencies:
      eslint:
        specifier: 9.0.0
        version: 9.0.0
      plugin:
        specifier: 2.0.0
        version: 2.0.0(eslint@9.0.0)
      prettier:
        specifier: 3.6.2
        version: 3.6.2

packages:

  debug@4.0.0:
    resolution: {integrity: sha512-DDDD==}

  eslint@9.0.0:
    resolution: {integrity: sha512-EEEE==}

  ms@2.0.0:
    resolution: {integrity: sha512-MMMM==}

  plugin@2.0.0:
    resolution: {integrity: sha512-PPPP==}
    peerDependencies:
      eslint: '>=9'

  prettier@3.6.2:
    resolution: {integrity: sha512-AAAA==}

snapshots:

  debug@4.0.0:
    dependencies:
      ms: 2.0.0

  eslint@9.0.0:
    dependencies:
      debug: 4.0.0

  ms@2.0.0:
    optional: true

  plugin@2.0.0(eslint@9.0.0):
    dependencies:
      debug: 4.0.0
      eslint: 9.0.0

  prettier@3.6.2: {}
`;
const DEV = { eslint: '9.0.0', plugin: '2.0.0', prettier: '3.6.2' };
// Applies [from, to] pairs (or functions of the text) in order.
const edits =
  (...pairs) =>
  (t) =>
    pairs.reduce((s, p) => {
      const next = typeof p === 'function' ? p(s) : s.replace(p[0], p[1]);
      assert.notEqual(next, s, `fixture edit applies: ${String(p[0] ?? p)}`);
      return next;
    }, t);
const graphVerify = (edit, dev = DEV) =>
  lockVerify(edit, LOCK_GRAPH, { 'package.json': pkgJson({ devDependencies: dev }) });
const addSnapshot = (entry) => (t) => `${t}\n${entry}`;

// package.json asks for prettier 3.6.3, which brings a new transitive dependency and an
// existing one. This is the change the push job exists for.
const PRETTIER_BUMP = [
  [
    '        specifier: 3.6.2\n        version: 3.6.2\n',
    '        specifier: 3.6.3\n        version: 3.6.3\n',
  ],
  [
    '  prettier@3.6.2:\n    resolution: {integrity: sha512-AAAA==}\n',
    '  left-pad@1.3.0:\n    resolution: {integrity: sha512-LLLL==}\n\n  prettier@3.6.3:\n    resolution: {integrity: sha512-BBBB==}\n',
  ],
  [
    '  prettier@3.6.2: {}\n',
    '  left-pad@1.3.0: {}\n\n  prettier@3.6.3:\n    dependencies:\n      debug: 4.0.0\n      left-pad: 1.3.0\n',
  ],
];
const BUMPED = { ...DEV, prettier: '3.6.3' };
// package.json asks for eslint 9.1.0: plugin keeps its specifier and gets a new peer variant.
const ESLINT_BUMP = [
  [
    '        specifier: 9.0.0\n        version: 9.0.0\n',
    '        specifier: 9.1.0\n        version: 9.1.0\n',
  ],
  ['        version: 2.0.0(eslint@9.0.0)\n', '        version: 2.0.0(eslint@9.1.0)\n'],
  [
    '  eslint@9.0.0:\n    resolution: {integrity: sha512-EEEE==}\n',
    '  eslint@9.1.0:\n    resolution: {integrity: sha512-FFFF==}\n',
  ],
  [
    '  eslint@9.0.0:\n    dependencies:\n      debug: 4.0.0\n',
    '  eslint@9.1.0:\n    dependencies:\n      debug: 4.0.0\n',
  ],
  [
    '  plugin@2.0.0(eslint@9.0.0):\n    dependencies:\n      debug: 4.0.0\n      eslint: 9.0.0\n',
    '  plugin@2.0.0(eslint@9.1.0):\n    dependencies:\n      debug: 4.0.0\n      eslint: 9.1.0\n',
  ],
];

test('verify (#196): accepts a direct bump with its new transitive dependencies', () => {
  ok(graphVerify(edits(...PRETTIER_BUMP), BUMPED));
  // A new alias that package.json asks for.
  ok(
    graphVerify(
      edits(
        [
          '        specifier: 3.6.2\n        version: 3.6.2\n',
          '        specifier: npm:fmt@1.0.0\n        version: fmt@1.0.0\n',
        ],
        [
          '  prettier@3.6.2:\n    resolution: {integrity: sha512-AAAA==}\n',
          '  fmt@1.0.0:\n    resolution: {integrity: sha512-GGGG==}\n',
        ],
        ['  prettier@3.6.2: {}\n', '  fmt@1.0.0: {}\n'],
      ),
      { ...DEV, prettier: 'npm:fmt@1.0.0' },
    ),
  );
  // optional: true may come and go on an existing snapshots entry.
  ok(
    graphVerify(
      edits(...PRETTIER_BUMP, ['  ms@2.0.0:\n    optional: true\n', '  ms@2.0.0: {}\n']),
      BUMPED,
    ),
  );
});

test('verify (#196): rejects a registry version that no package.json change asked for', () => {
  const unreachable =
    /new (snapshots|packages) entry \S+ is not reachable from a dependency whose specifier changed/;
  const variant =
    /new snapshots entry \S+ is a new peer variant of \S+, which the base lockfile already has/;
  const changed = /snapshots entry \S+ changed, although its key did not/;
  const msBump = [
    ['      ms: 2.0.0\n', '      ms: 2.1.0\n'],
    addPackage('  ms@2.1.0:\n    resolution: {integrity: sha512-NNNN==}\n'),
    addSnapshot('  ms@2.1.0: {}\n'),
  ];
  // [edits, expected error, devDependencies in package.json at HEAD]
  const cases = {
    'unrelated transitive bump next to a direct bump': [[...PRETTIER_BUMP, ...msBump], changed],
    'unrelated transitive bump on its own': [msBump, changed, DEV],
    'new entry that nothing depends on': [
      [
        ...PRETTIER_BUMP,
        addPackage('  evil@1.0.0:\n    resolution: {integrity: sha512-XXXX==}\n'),
        addSnapshot('  evil@1.0.0: {}\n'),
      ],
      unreachable,
    ],
    'new dependency added to an existing entry': [
      [...PRETTIER_BUMP, ['      ms: 2.0.0\n', '      left-pad: 1.3.0\n      ms: 2.0.0\n']],
      changed,
    ],
    'direct version change without a specifier change': [
      [
        [
          '        specifier: 9.0.0\n        version: 9.0.0\n',
          '        specifier: 9.0.0\n        version: 9.0.1\n',
        ],
        addPackage('  eslint@9.0.1:\n    resolution: {integrity: sha512-XXXX==}\n'),
        addSnapshot('  eslint@9.0.1:\n    dependencies:\n      debug: 4.0.0\n'),
      ],
      /eslint in importer \. changed from 9\.0\.0 to 9\.0\.1, but its specifier 9\.0\.0 did not change/,
      DEV,
    ],
    'specifier that package.json does not have': [
      PRETTIER_BUMP,
      /prettier: 3\.6\.3 in importer \. is not in the devDependencies of package\.json at HEAD/,
      DEV,
    ],
    'specifier in another package.json section': [
      PRETTIER_BUMP,
      /prettier: 3\.6\.3 in importer \. is not in the devDependencies of package\.json at HEAD/,
      'in dependencies',
    ],
    'range specifier': [
      [
        [
          '        specifier: 3.6.2\n        version: 3.6.2\n',
          "        specifier: '^3.6.2'\n        version: 3.6.3\n",
        ],
        ...PRETTIER_BUMP.slice(1),
      ],
      /specifier \^3\.6\.2 in importer \. is not an exact version/,
      { ...DEV, prettier: '^3.6.2' },
    ],
    'version that does not match the specifier': [
      [
        [
          '        specifier: 3.6.2\n        version: 3.6.2\n',
          '        specifier: 3.6.3\n        version: 3.6.4\n',
        ],
        ...PRETTIER_BUMP.slice(1).map(([a, b]) => [
          a,
          b.replaceAll('prettier@3.6.3', 'prettier@3.6.4'),
        ]),
      ],
      /prettier: version 3\.6\.4 in importer \. does not match its specifier 3\.6\.3/,
    ],
    // A forged peer suffix makes a new variant of plugin that depends on an unrelated package.
    'peer variant with a new dependency': [
      [
        [
          '        version: 2.0.0(eslint@9.0.0)\n',
          '        version: 2.0.0(eslint@9.0.0)(evil@1.0.0)\n',
        ],
        addPackage('  evil@1.0.0:\n    resolution: {integrity: sha512-XXXX==}\n'),
        addSnapshot(
          '  evil@1.0.0: {}\n\n  plugin@2.0.0(eslint@9.0.0)(evil@1.0.0):\n    dependencies:\n      debug: 4.0.0\n      eslint: 9.0.0\n      evil: 1.0.0\n',
        ),
      ],
      variant,
      DEV,
    ],
    // A peer variant may not add a dependency on another existing package either.
    'peer variant with an existing package as a new dependency': [
      [
        ['        version: 2.0.0(eslint@9.0.0)\n', '        version: 2.0.0(eslint@9.0.0)(x@1)\n'],
        addSnapshot(
          '  plugin@2.0.0(eslint@9.0.0)(x@1):\n    dependencies:\n      debug: 4.0.0\n      eslint: 9.0.0\n      ms: 2.0.0\n',
        ),
      ],
      variant,
      DEV,
    ],
    // ... nor move a dependency to another version that the base lockfile already has.
    'peer variant with another existing version of a dependency': [
      [
        addPackage('  debug@3.0.0:\n    resolution: {integrity: sha512-CCCC==}\n'),
        addSnapshot('  debug@3.0.0: {}\n'),
        ['        version: 2.0.0(eslint@9.0.0)\n', '        version: 2.0.0(eslint@9.0.0)(x@1)\n'],
        addSnapshot(
          '  plugin@2.0.0(eslint@9.0.0)(x@1):\n    dependencies:\n      debug: 3.0.0\n      eslint: 9.0.0\n',
        ),
      ],
      variant,
      DEV,
      2,
    ],
    // qa-58 (#217), repro 1: a forged peer suffix on a package whose specifier did not change
    // re-points a dependency that is not a peer (eslint -> debug) at a version from the bump.
    'forged peer suffix re-pointing a non-peer dependency': [
      [
        ...PRETTIER_BUMP,
        [
          '      debug: 4.0.0\n      left-pad: 1.3.0\n',
          '      debug: 4.1.0\n      left-pad: 1.3.0\n',
        ],
        addPackage('  debug@4.1.0:\n    resolution: {integrity: sha512-GGGG==}\n'),
        addSnapshot('  debug@4.1.0:\n    dependencies:\n      ms: 2.0.0\n'),
        [
          '        specifier: 9.0.0\n        version: 9.0.0\n',
          '        specifier: 9.0.0\n        version: 9.0.0(z@1)\n',
        ],
        addSnapshot('  eslint@9.0.0(z@1):\n    dependencies:\n      debug: 4.1.0\n'),
      ],
      /new snapshots entry eslint@9\.0\.0\(z@1\) is a new peer variant/,
    ],
    // Only names under peerDependencies are peers, not those under peerDependenciesMeta.
    'forged peer suffix re-pointing a name from peerDependenciesMeta': [
      [
        [
          "      eslint: '>=9'\n",
          "      eslint: '>=9'\n    peerDependenciesMeta:\n      debug:\n        optional: true\n",
        ],
        ...PRETTIER_BUMP,
        [
          '      debug: 4.0.0\n      left-pad: 1.3.0\n',
          '      debug: 4.1.0\n      left-pad: 1.3.0\n',
        ],
        addPackage('  debug@4.1.0:\n    resolution: {integrity: sha512-GGGG==}\n'),
        addSnapshot('  debug@4.1.0:\n    dependencies:\n      ms: 2.0.0\n'),
        ['        version: 2.0.0(eslint@9.0.0)\n', '        version: 2.0.0(eslint@9.0.0)(z@1)\n'],
        addSnapshot(
          '  plugin@2.0.0(eslint@9.0.0)(z@1):\n    dependencies:\n      debug: 4.1.0\n      eslint: 9.0.0\n',
        ),
      ],
      /new snapshots entry plugin@2\.0\.0\(eslint@9\.0\.0\)\(z@1\) is a new peer variant/,
      BUMPED,
      1,
    ],
    // A declared peer may only point at an entry that exists and is allowed.
    'peer variant pointing a peer at a missing entry': [
      [
        ['        version: 2.0.0(eslint@9.0.0)\n', '        version: 2.0.0(eslint@9.9.9)\n'],
        addSnapshot(
          '  plugin@2.0.0(eslint@9.9.9):\n    dependencies:\n      debug: 4.0.0\n      eslint: 9.9.9\n',
        ),
      ],
      /new snapshots entry plugin@2\.0\.0\(eslint@9\.9\.9\) is a new peer variant/,
      DEV,
    ],
    // qa-58 (#217), repro 2: the same trick adds a dependency name from the bumped subtree.
    'forged peer suffix adding a dependency from the bump': [
      [
        ...PRETTIER_BUMP,
        ['        version: 2.0.0(eslint@9.0.0)\n', '        version: 2.0.0(eslint@9.0.0)(z@1)\n'],
        addSnapshot(
          '  plugin@2.0.0(eslint@9.0.0)(z@1):\n    dependencies:\n      debug: 4.0.0\n      eslint: 9.0.0\n      left-pad: 1.3.0\n',
        ),
      ],
      /new snapshots entry plugin@2\.0\.0\(eslint@9\.0\.0\)\(z@1\) is a new peer variant/,
    ],
    // qa-58 (#217): a peer-only importer change whose new variant has no snapshots entry.
    'no snapshots entry for a peer-only importer change': [
      [
        ...ESLINT_BUMP.slice(0, 4),
        [
          '  plugin@2.0.0(eslint@9.0.0):\n    dependencies:\n      debug: 4.0.0\n      eslint: 9.0.0\n',
          '',
        ],
      ],
      /no snapshots entry for plugin@2\.0\.0\(eslint@9\.1\.0\)/,
      { ...DEV, eslint: '9.1.0' },
    ],
    'importer path that is not plain': [
      [
        (t) =>
          t.replace(
            '\npackages:\n',
            "\n  './':\n    devDependencies:\n      prettier:\n        specifier: 3.6.3\n        version: 3.6.3\n\npackages:\n",
          ),
        ...PRETTIER_BUMP.slice(1),
        ['        specifier: 3.6.2\n        version: 3.6.2\n', ''],
      ],
      /importer \.\/ is not a plain relative path/,
    ],
    // ALIAS is anchored: only the tail of npm:../x@1.0.0 looks like name@version.
    'malformed npm: specifier': [
      [
        [
          '        specifier: 3.6.2\n        version: 3.6.2\n',
          '        specifier: npm:../x@1.0.0\n        version: ../x@1.0.0\n',
        ],
        [
          '  prettier@3.6.2:\n    resolution: {integrity: sha512-AAAA==}\n',
          '  ../x@1.0.0:\n    resolution: {integrity: sha512-XXXX==}\n',
        ],
        ['  prettier@3.6.2: {}\n', '  ../x@1.0.0: {}\n'],
      ],
      /version \.\.\/x@1\.0\.0 in importer \. is not a registry version or npm alias/,
      { ...DEV, prettier: 'npm:../x@1.0.0' },
    ],
    'new packages entry without a snapshots entry': [
      [...PRETTIER_BUMP, addPackage('  evil@1.0.0:\n    resolution: {integrity: sha512-XXXX==}\n')],
      /new packages entry evil@1\.0\.0 is not reachable/,
    ],
    // #217 (security-40, R5 fallback): the legitimate eslint bump re-keys plugin, an existing
    // package, so it goes in a reviewed PR.
    'peer variant from a legitimate peer bump': [ESLINT_BUMP, variant, { ...DEV, eslint: '9.1.0' }],
    'no snapshots entry for a changed dependency': [
      [PRETTIER_BUMP[0], PRETTIER_BUMP[1], ['  prettier@3.6.2: {}\n', '']],
      /no snapshots entry for prettier@3\.6\.3/,
    ],
  };
  // The first `inBase` edits go into the base lockfile instead of the patch.
  for (const [name, [pairs, re, dev = BUMPED, inBase = 0]] of Object.entries(cases)) {
    const pj =
      dev === 'in dependencies'
        ? pkgJson({ dependencies: { prettier: '3.6.3' }, devDependencies: DEV })
        : pkgJson({ devDependencies: dev });
    const base = edits(...pairs.slice(0, inBase))(LOCK_GRAPH);
    const patch = pairs.slice(inBase);
    lockRejected(lockVerify(edits(...patch), base, { 'package.json': pj }), name, re);
  }
});

test('verify (#196): the integrity of an unchanged name@version may never change', () => {
  const re = /integrity or resolution of ms@2\.0\.0 changed, although its name and version did not/;
  const swap = ['{integrity: sha512-MMMM==}', '{integrity: sha512-EVIL==}'];
  lockRejected(graphVerify(edits(swap)), 'integrity swap', re);
  lockRejected(graphVerify(edits(...PRETTIER_BUMP, swap), BUMPED), 'swap next to a bump', re);
  lockRejected(
    graphVerify(
      edits([
        '{integrity: sha512-MMMM==}',
        '{integrity: sha512-MMMM==, tarball: https://registry.npmjs.org/evil/-/evil-1.0.0.tgz}',
      ]),
    ),
    'tarball added to an existing entry',
    re,
  );
  lockRejected(
    graphVerify(
      edits([
        '  ms@2.0.0:\n    resolution: {integrity: sha512-MMMM==}\n',
        '  ms@2.0.0:\n    resolution: {integrity: sha512-MMMM==}\n    hasBin: true\n',
      ]),
    ),
    'another field of an existing entry',
    /packages entry ms@2\.0\.0 changed, although its name and version did not/,
  );
  lockRejected(
    graphVerify(
      edits(...PRETTIER_BUMP, [
        '  left-pad@1.3.0:\n    resolution: {integrity: sha512-LLLL==}\n',
        '  left-pad@1.3.0:\n    resolution: {tarball: https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz}\n',
      ]),
      BUMPED,
    ),
    'new entry without an integrity',
    /new packages entry left-pad@1\.3\.0: its resolution must be exactly \{integrity: sha512-\.\.\.\}, with no tarball/,
  );
});

test('verify (#196): rejects npm aliases that no package.json specifier asks for', () => {
  const cases = {
    'alias as a dependency of a bumped package': [
      [
        PRETTIER_BUMP[0],
        [
          '  prettier@3.6.2:\n    resolution: {integrity: sha512-AAAA==}\n',
          '  evil@1.3.0:\n    resolution: {integrity: sha512-XXXX==}\n\n  prettier@3.6.3:\n    resolution: {integrity: sha512-BBBB==}\n',
        ],
        [
          '  prettier@3.6.2: {}\n',
          '  evil@1.3.0: {}\n\n  prettier@3.6.3:\n    dependencies:\n      left-pad: evil@1.3.0\n',
        ],
      ],
      /new snapshots entry prettier@3\.6\.3 depends on left-pad: evil@1\.3\.0, an npm alias/,
    ],
    'alias in importers that package.json does not have': [
      [
        [
          '        specifier: 3.6.2\n        version: 3.6.2\n',
          '        specifier: npm:evil@3.6.3\n        version: evil@3.6.3\n',
        ],
        [
          '  prettier@3.6.2:\n    resolution: {integrity: sha512-AAAA==}\n',
          '  evil@3.6.3:\n    resolution: {integrity: sha512-XXXX==}\n',
        ],
        ['  prettier@3.6.2: {}\n', '  evil@3.6.3: {}\n'],
      ],
      /prettier: npm:evil@3\.6\.3 in importer \. is not in the devDependencies/,
    ],
    'exact specifier resolved to an alias': [
      [
        [
          '        specifier: 3.6.2\n        version: 3.6.2\n',
          '        specifier: 3.6.3\n        version: evil@3.6.3\n',
        ],
        [
          '  prettier@3.6.2:\n    resolution: {integrity: sha512-AAAA==}\n',
          '  evil@3.6.3:\n    resolution: {integrity: sha512-XXXX==}\n',
        ],
        ['  prettier@3.6.2: {}\n', '  evil@3.6.3: {}\n'],
      ],
      /prettier: version evil@3\.6\.3 in importer \. does not match its specifier 3\.6\.3/,
    ],
  };
  for (const [name, [pairs, re]] of Object.entries(cases))
    lockRejected(graphVerify(edits(...pairs), BUMPED), name, re);
});

test('verify (#196): rejects @jsr/ packages and jsr: specifiers the base lockfile does not have', () => {
  const re = /git, URL, file:, link: or JSR entry that the base lockfile does not have/;
  // pnpm 10.9+ fetches the @jsr/ scope from npm.jsr.io and writes no tarball for it.
  lockRejected(
    graphVerify(
      edits(
        ...PRETTIER_BUMP.slice(0, 2),
        [
          '  prettier@3.6.2: {}\n',
          "  '@jsr/std__path@1.0.0': {}\n\n  left-pad@1.3.0: {}\n\n  prettier@3.6.3:\n    dependencies:\n      '@jsr/std__path': 1.0.0\n      left-pad: 1.3.0\n",
        ],
        addPackage("  '@jsr/std__path@1.0.0':\n    resolution: {integrity: sha512-JJJJ==}\n"),
      ),
      BUMPED,
    ),
    '@jsr/ package',
    re,
  );
  lockRejected(
    graphVerify(edits(['        specifier: 3.6.2\n', '        specifier: jsr:@std/fmt@3.6.2\n']), {
      ...DEV,
      prettier: 'jsr:@std/fmt@3.6.2',
    }),
    'jsr: specifier',
    re,
  );
});

test('verify (#196): rejects lockfile layouts that the graph parser does not read', () => {
  const marker = join(mkdtempSync(join(tmpdir(), 'pwp-marker-')), 'pwned');
  const cases = {
    'duplicate snapshots entry': [
      addSnapshot('  ms@2.0.0:\n    dependencies:\n      evil: 1.0.0\n'),
      /duplicate snapshots entry ms@2\.0\.0/,
    ],
    'duplicate packages section': [
      (t) => `${t}\npackages:\n\n  evil@1.0.0:\n    resolution: {integrity: sha512-XXXX==}\n`,
      /duplicate top-level key packages/,
    ],
    'duplicate importer entry': [
      [
        '      prettier:\n',
        '      prettier:\n        specifier: 3.6.2\n        version: 3.6.2\n      prettier:\n',
      ],
      /duplicate importer entry prettier/,
    ],
    'duplicate version line': [
      ['        version: 3.6.2\n', '        version: 3.6.2\n        version: 3.6.3\n'],
      /duplicate version/,
    ],
    'duplicate dependency': [
      ['      ms: 2.0.0\n', '      ms: 2.0.0\n      ms: 2.1.0\n'],
      /duplicate dependency ms of debug@4\.0\.0/,
    ],
    'flow-style dependencies': [
      ['  prettier@3.6.2: {}\n', '  prettier@3.6.2:\n    dependencies: {evil: 1.0.0}\n'],
      /flow-style dependencies/,
    ],
    'flow-style entry': [
      ['  prettier@3.6.2: {}\n', '  prettier@3.6.2: {dependencies: {evil: 1.0.0}}\n'],
      /entry that is not 'key:' or 'key: \{\}'/,
    ],
    'line outside an entry': [
      ['\npackages:\n', '\npackages:\n    stray: 1\n'],
      /line outside a packages entry/,
    ],
    'dependency that is not name: version': [
      ['      ms: 2.0.0\n', '      - ms\n'],
      /dependency of debug@4\.0\.0 that is not 'name: version'/,
    ],
    'nested value under dependencies': [
      ['      ms: 2.0.0\n', '      ms: 2.0.0\n        x: 1\n'],
      /nested value under the dependencies of debug@4\.0\.0/,
    ],
    comment: [
      ['      ms: 2.0.0\n', '      ms: 2.0.0 # 2.1.0\n'],
      /comment: pnpm does not write comments/,
    ],
    'odd indentation': [['      ms: 2.0.0\n', '       ms: 2.0.0\n'], /odd indentation/],
    'shell syntax in a key': [
      addSnapshot(`  x@1.0.0$(touch\${IFS}${marker}):\n    dependencies:\n      ms: 2.0.0\n`),
      /snapshots key \S+ is not name@version followed by balanced/,
    ],
  };
  try {
    for (const [name, [edit, re]] of Object.entries(cases))
      lockRejected(graphVerify(edits(edit)), name, re);
    assert.equal(spawnSync('test', ['-e', marker]).status, 1, 'no key ran as shell code');
  } finally {
    rmSync(dirname(marker), { recursive: true, force: true });
  }
});

// ---- #217 (security-40, R1-R8): the lockfile as pnpm reads it ----

// security-40's base (pbase.lock): plugin declares eslint as a peer.
const LOCK_PBASE = `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false

importers:

  .:
    devDependencies:
      eslint:
        specifier: 9.0.0
        version: 9.0.0
      plugin:
        specifier: 2.0.0
        version: 2.0.0(eslint@9.0.0)
      prettier:
        specifier: 3.6.2
        version: 3.6.2

packages:

  eslint@9.0.0:
    resolution: {integrity: sha512-EEEE==}

  ms@2.0.0:
    resolution: {integrity: sha512-MMMM==}

  plugin@2.0.0:
    resolution: {integrity: sha512-PPPP==}
    peerDependencies:
      eslint: '>=8'

  prettier@3.6.2:
    resolution: {integrity: sha512-AAAA==}

snapshots:

  eslint@9.0.0:
    dependencies:
      ms: 2.0.0

  ms@2.0.0: {}

  plugin@2.0.0(eslint@9.0.0):
    dependencies:
      eslint: 9.0.0

  prettier@3.6.2: {}
`;
const PDEV = { eslint: '9.0.0', plugin: '2.0.0', prettier: '3.6.2' };
const PBUMPED = { ...PDEV, prettier: '3.6.3' };
// pkgb.json: package.json asks for prettier 3.6.3. The edits make prettier 3.6.3 a root whose
// snapshot gets the dependency lines `deps` (security-40's fixtures put their payload there).
const pBump = (deps = '', extraPkgs = '') => [
  [
    '        specifier: 3.6.2\n        version: 3.6.2\n',
    '        specifier: 3.6.3\n        version: 3.6.3\n',
  ],
  [
    '  prettier@3.6.2:\n    resolution: {integrity: sha512-AAAA==}\n',
    `${extraPkgs}  prettier@3.6.3:\n    resolution: {integrity: sha512-BBBB==}\n`,
  ],
  [
    '  prettier@3.6.2: {}\n',
    deps ? `  prettier@3.6.3:\n    dependencies:\n${deps}` : '  prettier@3.6.3: {}\n',
  ],
];
const pVerify = (pairs, dev = PDEV) =>
  lockVerify(edits(...pairs), LOCK_PBASE, { 'package.json': pkgJson({ devDependencies: dev }) });
const PLUGIN_SNAP = '  plugin@2.0.0(eslint@9.0.0):\n    dependencies:\n      eslint: 9.0.0\n';
const variantRe = /is a new peer variant of \S+, which the base lockfile already has/;
const grammarRe = /snapshots key \S+ is not name@version followed by balanced \(\.\.\.\) groups/;

test('verify (#217): the legitimate bumps and the real lockfile still pass on pbase', () => {
  ok(pVerify(pBump(), PBUMPED));
  // A dependency whose name starts with a digit is a version ref, not an alias (R1).
  ok(
    pVerify(
      [
        ...pBump(
          '      7zip-bin: 5.2.0\n',
          '  7zip-bin@5.2.0:\n    resolution: {integrity: sha512-DDDD==}\n\n',
        ),
        addSnapshot('  7zip-bin@5.2.0: {}\n'),
      ],
      PBUMPED,
    ),
  );
});

test('verify (#217): R1 keys and refs follow pnpm removeSuffix and refToRelative', () => {
  const cases = {
    // A3: text after the last ")" makes another package id for pnpm, with its own resolution.
    A3: [
      [
        ['        version: 2.0.0(eslint@9.0.0)\n', '        version: 2.0.0(eslint@9.0.0)x\n'],
        addSnapshot(
          '  plugin@2.0.0(eslint@9.0.0)x:\n    resolution: {integrity: sha512-VVVV==, tarball: https://registry.npmjs.org/evil/-/evil-1.0.0.tgz}\n    dependencies:\n      eslint: 9.0.0\n',
        ),
      ],
      grammarRe,
    ],
    A3b: [
      [
        ['        version: 2.0.0(eslint@9.0.0)\n', '        version: 2.0.0(eslint@9.0.0)x(y@1)\n'],
        addSnapshot(
          '  plugin@2.0.0(eslint@9.0.0)x(y@1):\n    resolution: {integrity: sha512-VVVV==, tarball: https://registry.npmjs.org/evil/-/evil-1.0.0.tgz}\n    dependencies:\n      eslint: 9.0.0\n',
        ),
      ],
      grammarRe,
    ],
    // A8: pnpm reads 7zip-bin@5.2.0 as an alias (an "@" before any "("), whatever its first character.
    A8: [
      [
        ...pBump(
          '      7zip-bin: 5.2.0\n      ms: 7zip-bin@5.2.0\n',
          '  7zip-bin@5.2.0:\n    resolution: {integrity: sha512-DDDD==}\n\n',
        ),
        addSnapshot('  7zip-bin@5.2.0: {}\n\n  ms@7zip-bin@5.2.0: {}\n'),
      ],
      /new snapshots entry prettier@3\.6\.3 depends on ms: 7zip-bin@5\.2\.0, an npm alias/,
      PBUMPED,
    ],
    'A8 alias key': [
      [
        ...pBump(
          '      7zip-bin: 5.2.0\n      ms: 7zip-bin@5.2.0\n',
          '  7zip-bin@5.2.0:\n    resolution: {integrity: sha512-DDDD==}\n\n',
        ),
        addSnapshot('  7zip-bin@5.2.0: {}\n\n  ms@7zip-bin@5.2.0: {}\n'),
      ],
      /snapshots key ms@7zip-bin@5\.2\.0 is not name@version/,
      PBUMPED,
    ],
    A8b: [
      [
        ...pBump(
          '      7zip-bin: 5.2.0\n      eslint: 7zip-bin@5.2.0\n',
          '  7zip-bin@5.2.0:\n    resolution: {integrity: sha512-DDDD==}\n\n',
        ),
        [
          '        version: 2.0.0(eslint@9.0.0)\n',
          '        version: 2.0.0(eslint@7zip-bin@5.2.0)\n',
        ],
        addSnapshot(
          '  plugin@2.0.0(eslint@7zip-bin@5.2.0):\n    dependencies:\n      eslint: 7zip-bin@5.2.0\n\n  7zip-bin@5.2.0: {}\n',
        ),
      ],
      variantRe,
      PBUMPED,
    ],
    'unbalanced (': [
      [addSnapshot('  plugin@2.0.0((eslint@9.0.0):\n    dependencies:\n      eslint: 9.0.0\n')],
      grammarRe,
    ],
    'patch_hash suffix': [
      [addSnapshot('  ms@2.0.0(patch_hash=abc): {}\n')],
      /snapshots key ms@2\.0\.0\(patch_hash=abc\) is not name@version/,
    ],
    'packages key with a suffix': [
      [addPackage('  ms@2.0.0(x@1):\n    resolution: {integrity: sha512-MMMM==}\n')],
      /packages key ms@2\.0\.0\(x@1\) is not name@version/,
    ],
    'version that is not a registry version': [
      [['        version: 9.0.0\n', '        version: x9.0.0\n']],
      /eslint: version x9\.0\.0 in importer \. is not a registry version or npm alias/,
    ],
  };
  for (const [name, [pairs, re, dev]] of Object.entries(cases))
    lockRejected(pVerify(pairs, dev), name, re);
});

test('verify (#217): R2 snapshots and packages entries only have the fields pnpm writes', () => {
  const cases = {
    // A4 shape, with the packages entry kept: pnpm would use the snapshot's own resolution.
    'snapshot with resolution': [
      [
        [
          PLUGIN_SNAP,
          '  plugin@2.0.0(eslint@9.0.0):\n    resolution: {integrity: sha512-VVVV==, tarball: https://registry.npmjs.org/evil/-/evil-1.0.0.tgz}\n    dependencies:\n      eslint: 9.0.0\n',
        ],
      ],
      /snapshots field resolution of plugin@2\.0\.0\(eslint@9\.0\.0\)/,
    ],
    // A5: pnpm builds the tarball URL from this version.
    A5: [
      [
        ['        version: 2.0.0(eslint@9.0.0)\n', '        version: 2.0.0(eslint@9.0.0)(z@1)\n'],
        addSnapshot(
          '  plugin@2.0.0(eslint@9.0.0)(z@1):\n    version: 1.0.0\n    dependencies:\n      eslint: 9.0.0\n',
        ),
      ],
      /snapshots field version of plugin@2\.0\.0\(eslint@9\.0\.0\)\(z@1\)/,
    ],
    'snapshot with name': [
      [['  ms@2.0.0: {}\n', '  ms@2.0.0:\n    name: evil\n']],
      /snapshots field name of ms@2\.0\.0/,
    ],
    'packages entry with version': [
      [
        [
          '    resolution: {integrity: sha512-MMMM==}\n',
          '    resolution: {integrity: sha512-MMMM==}\n    version: 1.0.0\n',
        ],
      ],
      /packages field version of ms@2\.0\.0/,
    ],
    'tarball on a new packages entry of a legitimate bump': [
      [
        ...pBump(
          '      left-pad: 1.3.0\n',
          '  left-pad@1.3.0:\n    resolution: {integrity: sha512-LLLL==, tarball: https://registry.npmjs.org/evil/-/evil-1.0.0.tgz}\n\n',
        ),
        addSnapshot('  left-pad@1.3.0: {}\n'),
      ],
      /new packages entry left-pad@1\.3\.0: its resolution must be exactly \{integrity: sha512-\.\.\.\}, with no tarball/,
      PBUMPED,
    ],
  };
  for (const [name, [pairs, re, dev]] of Object.entries(cases))
    lockRejected(pVerify(pairs, dev), name, re);
});

test('verify (#217): R3 every snapshots key has a packages entry and every target exists', () => {
  // A4: the packages entry is gone, so pnpm would use the snapshot's own resolution.
  lockRejected(
    pVerify([
      ['        version: 2.0.0(eslint@9.0.0)\n', '        version: 2.0.0(eslint@9.0.0)(z@1)\n'],
      [
        "  plugin@2.0.0:\n    resolution: {integrity: sha512-PPPP==}\n    peerDependencies:\n      eslint: '>=8'\n\n",
        '',
      ],
      [
        PLUGIN_SNAP,
        '  plugin@2.0.0(eslint@9.0.0)(z@1):\n    resolution: {integrity: sha512-VVVV==, tarball: https://registry.npmjs.org/evil/-/evil-1.0.0.tgz}\n    dependencies:\n      eslint: 9.0.0\n',
      ],
    ]),
    'A4',
    /snapshots entry plugin@2\.0\.0\(eslint@9\.0\.0\)\(z@1\) has no packages entry plugin@2\.0\.0/,
  );
  lockRejected(
    pVerify(pBump('      left-pad: 1.3.0\n'), PBUMPED),
    'dangling dependency',
    /prettier@3\.6\.3 depends on left-pad: 1\.3\.0, which has no snapshots entry/,
  );
});

test('verify (#217): R4 and R5 a new peer variant of an existing name@version fails', () => {
  const cases = {
    // A1: reachable from the bump, but eslint@9.0.0 is an existing package.
    A1: [
      [
        ...pBump(
          '      eslint: 9.0.0(z@1)\n',
          '  evil@1.0.0:\n    resolution: {integrity: sha512-VVVV==}\n\n',
        ),
        ['        version: 9.0.0\n', '        version: 9.0.0(z@1)\n'],
        addSnapshot(
          '  eslint@9.0.0(z@1):\n    dependencies:\n      evil: 1.0.0\n      ms: 2.0.0\n\n  evil@1.0.0: {}\n',
        ),
      ],
      PBUMPED,
    ],
    A2: [
      [
        ...pBump(
          '      ms: 2.0.0(q@1)\n',
          '  evil@1.0.0:\n    resolution: {integrity: sha512-VVVV==}\n\n',
        ),
        ['        version: 9.0.0\n', '        version: 9.0.0(z@1)\n'],
        addSnapshot(
          '  eslint@9.0.0(z@1):\n    dependencies:\n      ms: 2.0.0(q@1)\n\n  evil@1.0.0: {}\n\n  ms@2.0.0(q@1):\n    dependencies:\n      evil: 1.0.0\n',
        ),
      ],
      PBUMPED,
    ],
    // A9: a variant that drops its eslint dependency.
    A9: [
      [
        ['        version: 2.0.0(eslint@9.0.0)\n', '        version: 2.0.0(z@1)\n'],
        addSnapshot('  plugin@2.0.0(z@1): {}\n'),
      ],
    ],
    // A11: a declared peer moved to a version only the bump brings.
    A11: [
      [
        ...pBump(
          '      eslint: 6.0.0\n',
          '  eslint@6.0.0:\n    resolution: {integrity: sha512-OLD6==}\n\n',
        ),
        ['        version: 2.0.0(eslint@9.0.0)\n', '        version: 2.0.0(eslint@6.0.0)\n'],
        [PLUGIN_SNAP, '  plugin@2.0.0(eslint@6.0.0):\n    dependencies:\n      eslint: 6.0.0\n'],
        addSnapshot('  eslint@6.0.0: {}\n'),
      ],
      PBUMPED,
    ],
    // qa-58 round 2: a declared peer pointed at an alias, without and with a bump.
    alias_peer2: [
      [
        ['        version: 2.0.0(eslint@9.0.0)\n', '        version: 2.0.0(eslint@ms@2.0.0)\n'],
        addSnapshot(
          '  plugin@2.0.0(eslint@ms@2.0.0):\n    dependencies:\n      eslint: ms@2.0.0\n',
        ),
      ],
    ],
    alias_peer: [
      [
        ...pBump(
          '      evil: 1.0.0\n',
          '  evil@1.0.0:\n    resolution: {integrity: sha512-VVVV==}\n\n',
        ),
        ['        version: 2.0.0(eslint@9.0.0)\n', '        version: 2.0.0(eslint@evil@1.0.0)\n'],
        addSnapshot(
          '  plugin@2.0.0(eslint@evil@1.0.0):\n    dependencies:\n      eslint: evil@1.0.0\n\n  evil@1.0.0: {}\n',
        ),
      ],
      PBUMPED,
    ],
    'peer moved to a second, non-root variant of the root': [
      [
        [
          '        specifier: 9.0.0\n        version: 9.0.0\n',
          '        specifier: 9.1.0\n        version: 9.1.0\n',
        ],
        addPackage('  eslint@9.1.0:\n    resolution: {integrity: sha512-FFFF==}\n'),
        addSnapshot('  eslint@9.1.0: {}\n\n  eslint@9.1.0(x@1): {}\n'),
        ['        version: 2.0.0(eslint@9.0.0)\n', '        version: 2.0.0(eslint@9.1.0(x@1))\n'],
        addSnapshot(
          '  plugin@2.0.0(eslint@9.1.0(x@1)):\n    dependencies:\n      eslint: 9.1.0(x@1)\n',
        ),
      ],
      { ...PDEV, eslint: '9.1.0' },
    ],
    'edge moved to optionalDependencies': [
      [
        ['        version: 2.0.0(eslint@9.0.0)\n', '        version: 2.0.0(eslint@9.0.0)(z@1)\n'],
        addSnapshot(
          '  plugin@2.0.0(eslint@9.0.0)(z@1):\n    optionalDependencies:\n      eslint: 9.0.0\n',
        ),
      ],
    ],
  };
  for (const [name, [pairs, dev]] of Object.entries(cases))
    lockRejected(pVerify(pairs, dev), name, variantRe);
});

test('verify (#217): R6 importers only change their dependency entries', () => {
  // A7: dependenciesMeta changes how a package is installed.
  lockRejected(
    pVerify([
      [
        '  .:\n    devDependencies:\n',
        '  .:\n    dependenciesMeta:\n      plugin:\n        injected: true\n    devDependencies:\n',
      ],
    ]),
    'A7',
    /importer \. changed outside its dependencies, devDependencies and optionalDependencies/,
  );
  lockRejected(
    pVerify([['        specifier: 3.6.2\n', '        specifier: 3.6.2\n        injected: true\n']]),
    'unknown field at indent 8',
    /importer entry field injected that is not specifier or version/,
  );
  lockRejected(
    pVerify([
      ['      ms: 2.0.0\n', '      ms: 2.0.0\n        x: 1\n'],
      ['        version: 3.6.2\n', '        version: 3.6.2\n          x: 1\n'],
    ]),
    'nested value in an importer entry',
    /nested value in importer entry/,
  );
  // A removed entry must be one that package.json no longer lists.
  lockRejected(
    pVerify([['      prettier:\n        specifier: 3.6.2\n        version: 3.6.2\n', '']]),
    'removed entry that package.json still lists',
    /prettier was removed from the devDependencies of importer \., but its package\.json still lists it/,
  );
  ok(
    pVerify(
      [
        ['      prettier:\n        specifier: 3.6.2\n        version: 3.6.2\n', ''],
        ['  prettier@3.6.2:\n    resolution: {integrity: sha512-AAAA==}\n\n', ''],
        ['\n  prettier@3.6.2: {}\n', ''],
      ],
      { eslint: '9.0.0', plugin: '2.0.0' },
    ),
  );
});

test('verify (#217): R7 top-level keys, lockfileVersion and settings', () => {
  const top =
    /top-level key \S+: the push job only accepts lockfileVersion, settings, overrides, importers, packages and snapshots/;
  const cases = {
    // security-40's A6 and A6b, one change at a time.
    'lockfileVersion 6.0': [
      ["lockfileVersion: '9.0'\n", "lockfileVersion: '6.0'\n"],
      /lockfileVersion differs from the base lockfile/,
    ],
    'settings changed': [
      ['  autoInstallPeers: true\n', '  autoInstallPeers: false\n'],
      /settings differs from the base lockfile/,
    ],
    'settings key added': [
      [
        '  excludeLinksFromLockfile: false\n',
        '  excludeLinksFromLockfile: false\n  injectWorkspacePackages: true\n',
      ],
      /settings differs from the base lockfile/,
    ],
    ignoredOptionalDependencies: [(t) => `${t}\nignoredOptionalDependencies:\n  - ms\n`, top],
    pnpmfileChecksum: [(t) => `${t}\npnpmfileChecksum: sha256-abc\n`, top],
    patchedDependencies: [
      (t) => `${t}\npatchedDependencies:\n  ms@2.0.0:\n    hash: abc\n    path: patches/ms.patch\n`,
      top,
    ],
    catalogs: [
      (t) => `${t}\ncatalogs:\n  default:\n    ms:\n      specifier: 2.0.0\n      version: 2.0.0\n`,
      top,
    ],
    time: [(t) => `${t}\ntime:\n  ms@2.0.0: '2020-01-01T00:00:00.000Z'\n`, top],
    packageExtensionsChecksum: [(t) => `${t}\npackageExtensionsChecksum: sha256-abc\n`, top],
  };
  for (const [name, [edit, re]] of Object.entries(cases)) lockRejected(pVerify([edit]), name, re);
  // overrides may change: ci's frozen install fails unless it matches pnpm-workspace.yaml.
  ok(pVerify([['\nimporters:\n', '\noverrides:\n  tinypool: 2.1.2\n\nimporters:\n']]));
});

// pbase with `baseEdits` applied, so a fixture can start from an importer or graph pbase lacks.
const pVerifyOn = (baseEdits, pairs, dev = PDEV) =>
  lockVerify(edits(...pairs), edits(...baseEdits)(LOCK_PBASE), {
    'package.json': pkgJson({ devDependencies: dev }),
  });
const PRETTIER_ENTRY = '      prettier:\n        specifier: 3.6.2\n        version: 3.6.2\n';
const addImporterEntry = (name, spec, ver) => [
  PRETTIER_ENTRY,
  `${PRETTIER_ENTRY}      ${name}:\n        specifier: ${spec}\n        version: ${ver}\n`,
];

test('verify (#217): a new direct dependency on a name@version the base lockfile has passes', () => {
  // The existing ms@2.0.0 is not walked, so its existing alias dependency is not re-checked.
  const base = [
    ['  ms@2.0.0: {}\n', '  ms@2.0.0:\n    dependencies:\n      sw: string-width@4.2.3\n'],
    addPackage('  string-width@4.2.3:\n    resolution: {integrity: sha512-EEEE==}\n'),
    addSnapshot('  string-width@4.2.3: {}\n'),
  ];
  ok(pVerifyOn(base, [addImporterEntry('ms', '2.0.0', '2.0.0')], { ...PDEV, ms: '2.0.0' }));
});

test('verify (#217): each check reports its own error, even where a later check also fails', () => {
  const imp =
    /importer \. changed outside its dependencies, devDependencies and optionalDependencies/;
  const meta = [
    [
      '    devDependencies:\n',
      '    dependenciesMeta:\n      foo:\n        injected: true\n    devDependencies:\n',
    ],
  ];
  const cases = [
    // R1: a ")" that closes nothing, even when a later "(" balances the count.
    ['suffix )(', [], [addSnapshot('  ms@2.0.0)(: {}\n')], grammarRe],
    [
      'alias version with an unbalanced suffix',
      [],
      [['        version: 3.6.2\n', '        version: ms@2.0.0)(\n']],
      /prettier: version ms@2\.0\.0\)\( in importer \. is not a registry version or npm alias/,
    ],
    [
      'version with an unbalanced suffix',
      [],
      [['        version: 3.6.2\n', '        version: 3.6.2)(\n']],
      /prettier: version 3\.6\.2\)\( in importer \. is not a registry version or npm alias/,
    ],
    [
      'dependency name that is not a package name',
      [],
      pBump('      m+s: 2.0.0\n'),
      /dependency of prettier@3\.6\.3 that is not 'name: version'/,
      PBUMPED,
    ],
    [
      'dependency ref with a shell character',
      [],
      pBump('      ms: 2.0.0($x)\n'),
      /dependency of prettier@3\.6\.3 that is not 'name: version'/,
      PBUMPED,
    ],
    // R4/R5: the importer error, besides the new-variant error for the snapshots entry.
    [
      'importer moved to a new variant',
      [],
      [
        ['        version: 2.0.0(eslint@9.0.0)\n', '        version: 2.0.0(ms@2.0.0)\n'],
        addSnapshot('  plugin@2.0.0(ms@2.0.0):\n    dependencies:\n      eslint: 9.0.0\n'),
      ],
      /plugin in importer \. moved to the new peer variant plugin@2\.0\.0\(ms@2\.0\.0\)/,
    ],
    // The snapshots error, besides the packages one.
    [
      'unreachable new snapshots entry',
      [],
      [
        addPackage('  left-pad@1.3.0:\n    resolution: {integrity: sha512-CCCC==}\n'),
        addSnapshot('  left-pad@1.3.0: {}\n'),
      ],
      /new snapshots entry left-pad@1\.3\.0 is not reachable/,
    ],
    // R6 roots.
    [
      'npm alias specifier with a range',
      [],
      [addImporterEntry('alias', 'npm:ms@^2.0.0', 'ms@2.0.0')],
      /specifier npm:ms@\^2\.0\.0 in importer \. is not an exact version or npm:name@version/,
      { ...PDEV, alias: 'npm:ms@^2.0.0' },
    ],
    [
      'exact specifier with an alias version',
      [],
      [addImporterEntry('ms', '2.0.0', 'ms@2.0.0')],
      /ms: version ms@2\.0\.0 in importer \. does not match its specifier 2\.0\.0/,
      { ...PDEV, ms: '2.0.0' },
    ],
    // R6: each level of an importer's other sections is compared.
    [
      'new importer section',
      [],
      [['    devDependencies:\n', '    publishDirectory: dist\n    devDependencies:\n']],
      imp,
    ],
    ['renamed entry in an importer section', meta, [['      foo:\n', '      bar:\n']], imp],
    [
      'changed value in an importer section',
      meta,
      [['        injected: true\n', '        injected: false\n']],
      imp,
    ],
  ];
  for (const [name, base, pairs, re, dev = PDEV] of cases) {
    lockRejected(pVerifyOn(base, pairs, dev), name, re);
  }
});

// ---- #223 (security-40): duplicate keys, which pnpm refuses (ERR_PNPM_BROKEN_LOCKFILE) ----

// pBump plus `fields` after the resolution line of the new packages entry prettier@3.6.3.
const PRETTIER_RES = '    resolution: {integrity: sha512-BBBB==}\n';
const pFields = (fields, deps = '') => [...pBump(deps), [PRETTIER_RES, `${PRETTIER_RES}${fields}`]];

test('verify (#223): a duplicate key in a packages, snapshots or importer entry fails', () => {
  const dup = (key, under) =>
    new RegExp(`duplicate key ${key} under ${under.replace(/[.()]/g, '\\$&')}: pnpm refuses`);
  const flowDup = (key) => new RegExp(`duplicate key '${key}' in \\{\\.\\.\\.\\}: pnpm refuses`);
  const nonStr = /key '1\.00?'.*YAML reads it as null, a boolean, a number or a timestamp/;
  const pkg = 'packages > prettier@3.6.3';
  const cases = {
    // security-40's fixture: a second resolution that points at another tarball.
    'packages: two resolution lines': [
      pFields(
        '    resolution: {integrity: sha512-VVVV==, tarball: https://registry.npmjs.org/evil/-/evil-1.0.0.tgz}\n',
      ),
      dup('resolution', pkg),
    ],
    'packages: the same key quoted and with a space before the colon': [
      pFields("    'hasBin': true\n    hasBin : true\n"),
      dup('hasBin', pkg),
    ],
    'packages: a duplicate in a nested mapping': [
      pFields("    peerDependencies:\n      eslint: '>=8'\n      'eslint': '>=9'\n"),
      dup('eslint', `${pkg} > peerDependencies`),
    ],
    'packages: keys YAML reads as the same number': [
      pFields("    peerDependencies:\n      1.0: '>=1'\n      1.00: '>=2'\n"),
      nonStr,
    ],
    'packages: a duplicate in a flow mapping': [
      pFields("    engines: {node: '>=18', node: '>=20'}\n"),
      flowDup('node'),
    ],
    'packages: a quoted duplicate in a nested flow mapping': [
      pFields("    peerDependenciesMeta: {eslint: {optional: true, 'optional': false}}\n"),
      flowDup('optional'),
    ],
    'packages: a duplicate in a mapping in a list item': [
      pFields('    bundledDependencies:\n      - a: 1\n      - a: 1\n        a: 2\n'),
      /duplicate key a under packages > prettier@3\.6\.3 > bundledDependencies > the list item on line \d+: pnpm refuses/,
    ],
    'packages: a duplicate in a flow mapping in a list item': [
      pFields('    bundledDependencies:\n      - {a: 1, a: 2}\n'),
      flowDup('a'),
    ],
    'packages: a number key in a flow mapping': [
      pFields('    engines: {1.0: x, 1.00: y}\n'),
      nonStr,
    ],
    'snapshots: two dependencies sections': [
      pBump('      ms: 2.0.0\n    dependencies:\n      eslint: 9.0.0\n'),
      dup('dependencies', 'snapshots > prettier@3.6.3'),
    ],
    'snapshots: two optional lines': [
      [
        ...pBump(),
        ['  prettier@3.6.3: {}\n', '  prettier@3.6.3:\n    optional: true\n    optional: false\n'],
      ],
      dup('optional', 'snapshots > prettier@3.6.3'),
    ],
    'snapshots: two transitivePeerDependencies lists': [
      pBump(
        '      ms: 2.0.0\n    transitivePeerDependencies:\n      - a\n    transitivePeerDependencies:\n      - b\n',
      ),
      dup('transitivePeerDependencies', 'snapshots > prettier@3.6.3'),
    ],
    // security-40's n5: a second devDependencies section in the same importer.
    'importers: two devDependencies sections': [
      [
        ...pBump(),
        [
          '        specifier: 3.6.3\n        version: 3.6.3\n',
          '        specifier: 3.6.3\n        version: 3.6.3\n\n    devDependencies:\n      plugin:\n        specifier: 2.0.0\n        version: 2.0.0(eslint@9.0.0)\n',
        ],
      ],
      dup('devDependencies', 'importers > .'),
    ],
    'importers: a quoted duplicate version': [
      [
        ...pBump(),
        ['        version: 3.6.3\n', "        version: 3.6.3\n        'version': 3.6.2\n"],
      ],
      dup('version', 'importers > . > devDependencies > prettier'),
    ],
    'overrides: a duplicate override': [
      [...pBump(), ['\nimporters:\n', '\noverrides:\n  ms: 2.0.0\n  ms: 2.0.1\n\nimporters:\n']],
      dup('ms', 'overrides'),
    ],
  };
  for (const [name, [pairs, re]] of Object.entries(cases))
    lockRejected(pVerify(pairs, PBUMPED), name, re);
});

// security-45 (round 1): keys that js-yaml reads differently from their text.
test('verify (#223): flow collections as keys and ._5 floats fail', () => {
  const flowKey = /line that starts with \[ or \{: YAML reads a flow collection there as a key/;
  const nonStr = (k) =>
    new RegExp(`key '${k.replace(/[.]/g, '\\.')}': YAML reads it as null, a boolean, a number`);
  const importers = (lines) => [...pBump(), ['\nimporters:\n\n', `\nimporters:\n\n${lines}\n`]];
  const overrides = (lines) => [
    ...pBump(),
    ['\nimporters:\n', `\noverrides:\n${lines}\nimporters:\n`],
  ];
  const cases = {
    // w_b9: js-yaml reads [.] as the key ".", the same as the root importer.
    'importers: [.] next to .': [importers('  [.]: {}\n'), flowKey],
    // x_b10: ._5 is the float 0.5, so the same key as '0.5'.
    'importers: ._5 next to 0.5': [importers("  ._5: {}\n\n  '0.5': {}\n"), nonStr('._5')],
    'overrides: [ms] next to ms': [overrides('  [ms]: 2.0.0\n  ms: 2.0.0\n'), flowKey],
    "overrides: ['ms'] next to ms": [overrides("  ['ms']: 2.0.0\n  ms: 2.0.0\n"), flowKey],
    'overrides: [ms] twice': [overrides('  [ms]: 2.0.0\n  [ms]: 2.0.1\n'), flowKey],
    // Both are the key "[object Object]".
    'overrides: two {...} keys': [overrides('  {a: 1}: 2.0.0\n  {b: 1}: 2.0.1\n'), flowKey],
    'overrides: a flow key in a list item': [overrides('  - [ms]: 2.0.0\n'), flowKey],
    'overrides: ._5 next to 0.5': [overrides("  ._5: 2.0.0\n  '0.5': 2.0.0\n"), nonStr('._5')],
    // qa-65: a quoted flow key and a plain one are the same key.
    "packages: {'node':x, node: y}": [
      pFields("    engines: {'node':x, node: y}\n"),
      /duplicate key 'node' in \{\.\.\.\}: pnpm refuses/,
    ],
  };
  for (const [name, [pairs, re]] of Object.entries(cases))
    lockRejected(pVerify(pairs, PBUMPED), name, re);
  // qa-65: a quoted number-like flow key is a string, so it passes.
  ok(pVerify(pFields("    engines: {'1.0': x}\n"), PBUMPED));
});

test('verify (#223): the same key in different mappings, and look-alikes, still pass', () => {
  // A comma inside a quoted value, the same key in two flow mappings and under two parents,
  // repeated sequence items, and a deprecation message that looks like a flow mapping.
  const fields = [
    "    engines: {node: '>=18, <27', npm: '>=10'}",
    '    cpu: [x64, x64]',
    '    os: [{node: 1}, {node: 1}]',
    '    bundledDependencies:',
    '      - a: 1',
    '        b: 1',
    '      - a: 2',
    '        b: 2',
    '    peerDependencies:',
    "      eslint: '>=8'",
    "      '@types/node': '>=20'",
    '    peerDependenciesMeta:',
    '      eslint:',
    '        optional: true',
    "      '@types/node':",
    '        optional: true',
    '    deprecated: use {a, a} instead',
    '',
  ].join('\n');
  ok(
    pVerify(
      pFields(
        fields,
        '      ms: 2.0.0\n    transitivePeerDependencies:\n      - eslint\n      - eslint\n',
      ),
      PBUMPED,
    ),
  );
});

test('verify (#223): a new scoped npm alias root (npm:@scope/fmt@1.0.0) passes', () => {
  const scoped = (pkgs, snap) =>
    pVerify(
      [
        [
          '        specifier: 3.6.2\n        version: 3.6.2\n',
          "        specifier: npm:@scope/fmt@1.0.0\n        version: '@scope/fmt@1.0.0'\n",
        ],
        ['  prettier@3.6.2:\n    resolution: {integrity: sha512-AAAA==}\n', pkgs],
        ['  prettier@3.6.2: {}\n', snap],
      ],
      { ...PDEV, prettier: 'npm:@scope/fmt@1.0.0' },
    );
  const FMT = "  '@scope/fmt@1.0.0':\n    resolution: {integrity: sha512-GGGG==}\n";
  // qa-58's fixture (scoped.lock), on pbase.
  ok(scoped(FMT, "  '@scope/fmt@1.0.0': {}\n"));
  // With a new scoped transitive dependency and an existing one.
  ok(
    scoped(
      `${FMT}\n  '@scope/util@1.0.0':\n    resolution: {integrity: sha512-UUUU==}\n`,
      "  '@scope/fmt@1.0.0':\n    dependencies:\n      '@scope/util': 1.0.0\n      ms: 2.0.0\n\n  '@scope/util@1.0.0': {}\n",
    ),
  );
  // The same root with a second resolution line still fails.
  lockRejected(
    scoped(`${FMT}    resolution: {integrity: sha512-HHHH==}\n`, "  '@scope/fmt@1.0.0': {}\n"),
    'scoped alias with two resolution lines',
    /duplicate key resolution under packages > @scope\/fmt@1\.0\.0: pnpm refuses/,
  );
});
