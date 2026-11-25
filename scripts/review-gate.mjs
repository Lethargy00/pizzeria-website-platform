#!/usr/bin/env node
// review-gate (PROMPT.md §11.2): compares a PR's changed paths and labels with the
// review matrix and fails if a required approved:<role> label is missing.
// The signed APPROVED comment is checked by the Orchestrator (one shared account, Q10.6).
import { Buffer } from 'node:buffer';
import { posix } from 'node:path';
import { pathToFileURL } from 'node:url';
import { matchesAny } from './lib/glob.mjs';

/**
 * #162: every reviewed row matches paths without regard to case. On a case-insensitive
 * filesystem (macOS, Windows) a checkout of `.PNPMFILE.cjs`, `.NPMRC` or `Package.json` is the
 * file pnpm reads, so a case variant must need the same approvals as the exact path. Matching
 * more paths than needed only asks for more review (fail closed). manifestProofs stays
 * case-sensitive, so a case variant of a workspace manifest is never proven unchanged.
 */
const reviewed = (f, globs) => matchesAny(f, globs, { nocase: true });

/**
 * ADR 0002 Enforcement (c), #81: the rich-text chokepoint and the checks that guard it.
 * Every change here needs approved:security, whatever other rows say (#93 narrowed the
 * dependency row; this row keeps packages/core/package.json, which holds the ./richtext
 * export, under security review on its own). Mirrored in .github/CODEOWNERS.
 */
export const RICHTEXT_PATHS = [
  'packages/core/src/richtext/**', // renderMarkdown, the SafeHtml constructor, the sanitize schema
  'packages/core/package.json', // the "./richtext" subpath export
  'scripts/boundaries.json', // ADR 0002 (a): the import rule (#79)
  'scripts/check-boundaries.mjs', // ADR 0002 (a): the check that enforces it (#79)
  'scripts/check-html-sinks.mjs', // ADR 0002 (b), (d): HTML sinks take only SafeHtml (#80)
  'scripts/test/richtext-*', // the fixtures that prove (a) works
  'scripts/test/*html-sink*', // the fixtures that prove (b) and (d) work
];

/**
 * pnpm also reads a manifest written as package.yaml or package.json5 (#120). The gate cannot
 * parse those without a dependency, so wherever one appears it always counts as a dependency
 * change (fail closed) and is never eligible for the field-by-field proof below.
 */
export const ALT_MANIFESTS = [
  'package.{yaml,json5}',
  'playground/package.{yaml,json5}',
  'packages/*/package.{yaml,json5}',
];

/** Always a dependency change when touched: the lockfile and the root / playground manifests. */
export const DEPENDENCY_PATHS = [
  'pnpm-lock.yaml',
  'package.json',
  'playground/package.json',
  'pnpm-workspace.yaml',
  '.npmrc',
  // #128: pnpm install loads the root pnpmfile and runs its code and hooks (readPackage,
  // afterAllResolved), even with --ignore-scripts. A pnpmfile path set in .npmrc or
  // pnpm-workspace.yaml is already covered by those two entries.
  '.pnpmfile.cjs',
  '.pnpmfile.mjs',
  ...ALT_MANIFESTS,
];

/** Workspace package manifests: a dependency change only if a DEPENDENCY_FIELDS value differs. */
export const PACKAGE_MANIFESTS = 'packages/*/package.json';

/**
 * Top-level package.json fields that decide what gets installed, how, or with which engine.
 * The #93 list, plus the fields next to it that pnpm or npm also read when installing.
 * #120 added: bin (pnpm links it into dependents' node_modules/.bin, so it changes PATH),
 * name and version (they decide what a workspace: range resolves to), and devEngines, os,
 * cpu, libc (they decide whether and where a package installs).
 * #143 added: directories (pnpm 10.28 links every file in directories.bin into dependents'
 * node_modules/.bin when bin is absent, the same PATH change as bin) and publishConfig
 * (with publishConfig.directory set and linkDirectory not false, pnpm links dependents to that
 * directory instead of the package root, and records it in the lockfile). Both compare as a
 * whole field: any edit inside them, including keys pnpm ignores today, counts as a change.
 */
export const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
  'overrides',
  'pnpm',
  'engines',
  'packageManager',
  'peerDependenciesMeta',
  'dependenciesMeta',
  'bundleDependencies',
  'bundledDependencies',
  'resolutions',
  'workspaces',
  'bin',
  'name',
  'version',
  'devEngines',
  'os',
  'cpu',
  'libc',
  'directories',
  'publishConfig',
];

/**
 * Install-time lifecycle scripts: pnpm install runs these, so they count as dependency changes.
 * #176 added pnpm:devPreinstall, which pnpm runs from the root manifest before installing.
 */
export const INSTALL_SCRIPTS = [
  'pnpm:devPreinstall',
  'preinstall',
  'install',
  'postinstall',
  'preprepare',
  'prepare',
  'postprepare',
  'prepublish',
];

const parseObject = (text) => {
  const v = JSON.parse(text);
  if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object');
  return v;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Globs of the security row (needs approved:security). Exported so tests read the list itself
 * instead of parsing source text; build it with spreads if you like, the export is the full list.
 * Every glob needs a CODEOWNERS security note (checked by review-gate-richtext.test.mjs).
 */
export const SECURITY_PATHS = [
  'packages/functions/**',
  'packages/adapters/**',
  'packages/ui/src/components/*Form*/**',
  'packages/**/sanitize*/**',
  'packages/**/*sanitiz*',
  'packages/**/csp/**',
  'packages/**/*csp*',
  'packages/**/headers/**',
  'packages/cli/src/build/**',
  'packages/cli/src/isolation/**',
  '.github/workflows/**',
  'scripts/tenant-guard.mjs',
  'scripts/review-gate.mjs',
  'scripts/touches-guard.mjs',
  'scripts/*-guard.mjs', // every gate script, including future ones (#93)
  'scripts/lib/**', // shared by the gates: glob.mjs can blind them all (#93)
  'scripts/check-licenses.mjs', // the license gate in security.yml (#128)
  '**/.env.example',
  'SECURITY.md',
  'docs/SECURITY.md',
  'docs/THREAT-MODEL.md',
  '.github/CODEOWNERS',
];

/**
 * Which dependency fields differ between two package.json texts. Fails closed: if either side
 * is not a string, does not parse, or is not a JSON object, or the comparison itself throws
 * (JSON.stringify raises RangeError on very deep nesting, #120), the answer is "changed".
 * Key order inside a field counts as a change too (JSON.stringify), which can only ask for
 * more review; the order of the top-level fields does not. Never throws.
 * @returns {{ changed: boolean, why: string }}
 */
export function dependencyFieldsChanged(baseText, headText) {
  try {
    return compareDependencyFields(baseText, headText);
  } catch (e) {
    return { changed: true, why: `comparison failed (${e?.name ?? 'error'})` };
  }
}

function compareDependencyFields(baseText, headText) {
  if (typeof baseText !== 'string' || typeof headText !== 'string')
    return { changed: true, why: 'content unavailable' };
  let base, head;
  try {
    base = parseObject(baseText);
    head = parseObject(headText);
  } catch (e) {
    return { changed: true, why: `unparsable package.json (${e.message})` };
  }
  const diff = DEPENDENCY_FIELDS.filter((k) => !same(base[k], head[k]));
  const bs = base.scripts ?? {};
  const hs = head.scripts ?? {};
  if (typeof bs !== 'object' || typeof hs !== 'object') diff.push('scripts');
  else diff.push(...INSTALL_SCRIPTS.filter((k) => !same(bs[k], hs[k])).map((k) => `scripts.${k}`));
  // #176: pnpm passes every manifest field to an install script as npm_package_* environment
  // variables, so while either side declares one, any change to the manifest is a dependency change.
  if (!diff.length && !same(base, head)) {
    const declared = INSTALL_SCRIPTS.filter((k) => Object.hasOwn(bs, k) || Object.hasOwn(hs, k));
    if (declared.length)
      return {
        changed: true,
        why: `declares install script ${declared.map((k) => `scripts.${k}`).join(', ')}, so any change counts`,
      };
  }
  return diff.length
    ? { changed: true, why: `changed: ${diff.join(', ')}` }
    : { changed: false, why: 'no dependency field changed' };
}

export const MATRIX = [
  { id: 'peer', approval: 'approved:peer', when: () => true, why: 'every PR needs a peer review' },
  {
    id: 'architect',
    approval: 'approved:architect',
    why: 'contract, public API or package boundary change',
    when: (f) =>
      reviewed(f, [
        'packages/schema/**',
        'packages/*/src/contracts/**',
        'packages/adapters/src/interfaces/**',
        'scripts/boundaries.json',
        'docs/adr/**',
        'packages/*/package.json',
        'packages/*/package.{yaml,json5}', // #120: pnpm reads these as the manifest too
      ]),
  },
  {
    id: 'dependency',
    approval: ['approved:architect', 'approved:security'],
    why: 'dependency change (also link an approved type:dependency issue)',
    // #93: a packages/*/package.json is skipped only when the gate has PROVEN that none of its
    // DEPENDENCY_FIELDS changed (ctx.noDependencyChange). Without that proof it matches, as before.
    // #176: so is any path under a directory that an install script runs code from
    // (ctx.installScriptDirs, from installScriptCoverage).
    when: (f, _labels, ctx = {}) =>
      reviewed(f, DEPENDENCY_PATHS) ||
      (reviewed(f, [PACKAGE_MANIFESTS]) && !ctx.noDependencyChange?.has(f)) ||
      coveredByInstallScript(f, ctx.installScriptDirs),
  },
  {
    id: 'security',
    approval: 'approved:security',
    why: 'security-sensitive path',
    when: (f, labels) => labels.includes('security:sensitive') || reviewed(f, SECURITY_PATHS),
  },
  {
    id: 'richtext',
    approval: 'approved:security',
    why: 'rich-text chokepoint or its checks (ADR 0002 (c))',
    when: (f) => reviewed(f, RICHTEXT_PATHS),
  },
  {
    id: 'a11y-perf',
    approval: 'approved:a11y-perf',
    why: 'user-visible change',
    when: (f) =>
      reviewed(f, ['packages/ui/**', 'packages/themes/**', 'packages/tokens/**', 'playground/**']),
  },
];

/**
 * @returns {{ required: Map<string,string[]>, missing: {label:string, reasons:string[]}[], blocking: boolean }}
 * @param {string[]} files changed paths
 * @param {string[]} labels PR labels
 * @param {{ noDependencyChange?: Set<string>, installScriptDirs?: string[] }} [ctx]
 *   noDependencyChange: manifests proven free of dependency changes (see manifestProofs). Leave
 *   it out and every manifest counts as a dependency change. installScriptDirs: directories an
 *   install script runs code from (see installScriptCoverage); the CLI always passes it.
 */
export function evaluate(files, labels, ctx = {}) {
  const required = new Map();
  for (const row of MATRIX) {
    const hits = row.id === 'peer' ? ['(any)'] : files.filter((f) => row.when(f, labels, ctx));
    if (row.id === 'security' && labels.includes('security:sensitive') && !hits.length)
      hits.push('(label security:sensitive)');
    if (!hits.length) continue;
    for (const a of [row.approval].flat()) {
      const reasons = required.get(a) ?? [];
      reasons.push(`${row.why}: ${hits.slice(0, 3).join(', ')}${hits.length > 3 ? ', …' : ''}`);
      required.set(a, reasons);
    }
  }
  const missing = [...required]
    .filter(([a]) => !labels.includes(a))
    .map(([label, reasons]) => ({ label, reasons }));
  return { required, missing, blocking: labels.includes('security:blocking') };
}

async function gh(path) {
  const res = await fetch(`https://api.github.com/${path}`, {
    headers: {
      authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      accept: 'application/vnd.github+json',
    },
  });
  if (!res.ok) throw new Error(`GitHub API ${path}: ${res.status}`);
  return res.json();
}

/**
 * Paths a PR changes, from the pulls/files API entries. A rename contributes both its new
 * `filename` and its `previous_filename`, so a rename cannot hide the path it removes.
 */
export function changedPaths(apiFiles) {
  const out = [];
  for (const f of apiFiles) {
    out.push(f.filename);
    if (f.previous_filename && f.previous_filename !== f.filename) out.push(f.previous_filename);
  }
  return [...new Set(out)];
}

/** The pulls API never lists more than this many files / commits for one PR. */
export const FILES_CAP = 3000;
export const COMMITS_CAP = 250;

/** Fail closed: a list at the API cap may be truncated, so nothing can be judged from it. */
export function assertNotTruncated(kind, count, cap) {
  if (count >= cap) {
    throw new Error(
      `✗ PR lists ${count} ${kind}, the GitHub API maximum (${cap}); the list may be truncated, ` +
        'so the gates cannot check it. Split the PR into smaller PRs.',
    );
  }
}

export async function prFilesAndLabels(repo, pr, api = gh) {
  const files = [];
  const apiFiles = [];
  for (let page = 1; ; page++) {
    const batch = await api(`repos/${repo}/pulls/${pr}/files?per_page=100&page=${page}`);
    apiFiles.push(...batch);
    files.push(...changedPaths(batch));
    if (batch.length < 100) break;
  }
  assertNotTruncated('files', apiFiles.length, FILES_CAP);
  const issue = await api(`repos/${repo}/issues/${pr}`);
  return { files, apiFiles, labels: issue.labels.map((l) => l.name), body: issue.body ?? '' };
}

/**
 * The contents API inlines files up to 1 MB as base64; anything else is "unavailable".
 * With `expect`, the entry must also be for exactly that path (and blob sha, when given):
 * the API answers a symlink with its target's content, so an entry for another path is
 * not the file the PR changed (#120).
 * @param {any} entry contents API response
 * @param {{ path?: string, sha?: string }} [expect]
 */
export function decodeContents(entry, expect = {}) {
  if (entry?.type !== 'file' || entry.encoding !== 'base64' || typeof entry.content !== 'string')
    return undefined;
  if ('path' in expect && (typeof expect.path !== 'string' || entry.path !== expect.path))
    return undefined;
  if ('sha' in expect && (typeof expect.sha !== 'string' || entry.sha !== expect.sha))
    return undefined;
  return Buffer.from(entry.content, 'base64').toString('utf8');
}

/**
 * #93: for each modified workspace manifest (PACKAGE_MANIFESTS), compare its dependency fields at the merge
 * base and at the PR head. Returns the paths PROVEN unchanged, plus a note per manifest.
 * Fails closed: an added, removed, renamed or copied manifest, a missing merge base, or any
 * fetch / decode / parse problem leaves the path out of the set, so the dependency row applies.
 * #120: the head content must be the blob the files list names (same path and sha), and the
 * base content must be for the same path, so a symlink cannot stand in for the manifest.
 * @param {(path: string) => Promise<any>} api GitHub REST GET (injected for tests)
 * @returns {Promise<{ noDependencyChange: Set<string>, notes: string[] }>}
 */
export async function manifestProofs(repo, pr, apiFiles, api = gh) {
  const noDependencyChange = new Set();
  const notes = [];
  const manifests = apiFiles.filter(
    (f) =>
      matchesAny(f.filename, [PACKAGE_MANIFESTS]) ||
      (f.previous_filename && matchesAny(f.previous_filename, [PACKAGE_MANIFESTS])),
  );
  if (!manifests.length) return { noDependencyChange, notes };
  let mergeBase, head;
  try {
    const pull = await api(`repos/${repo}/pulls/${pr}`);
    head = pull?.head?.sha;
    const cmp = await api(`repos/${repo}/compare/${pull?.base?.sha}...${head}?per_page=1`);
    mergeBase = cmp?.merge_base_commit?.sha;
  } catch (e) {
    notes.push(`dependency row kept for every manifest: ${e.message}`);
    return { noDependencyChange, notes };
  }
  const sha = /^[0-9a-f]{40}$/;
  if (!sha.test(String(mergeBase)) || !sha.test(String(head))) {
    notes.push('dependency row kept for every manifest: merge base or head commit unknown');
    return { noDependencyChange, notes };
  }
  for (const f of manifests) {
    const path = f.filename;
    if (f.status !== 'modified' || (f.previous_filename && f.previous_filename !== path)) {
      notes.push(`${path}: dependency row kept (status ${f.status})`);
      continue;
    }
    const enc = path.split('/').map(encodeURIComponent).join('/');
    let r;
    try {
      const [b, h] = await Promise.all([
        api(`repos/${repo}/contents/${enc}?ref=${mergeBase}`),
        api(`repos/${repo}/contents/${enc}?ref=${head}`),
      ]);
      const bt = decodeContents(b, { path });
      const ht = decodeContents(h, { path, sha: f.sha });
      r =
        bt === undefined || ht === undefined
          ? { changed: true, why: 'content unavailable or not the listed path and blob' }
          : dependencyFieldsChanged(bt, ht);
    } catch (e) {
      r = { changed: true, why: e.message };
    }
    if (r.changed) notes.push(`${path}: dependency row kept (${r.why})`);
    else {
      noDependencyChange.add(path);
      notes.push(`${path}: ${r.why}, dependency row skipped`);
    }
  }
  return { noDependencyChange, notes };
}

/**
 * #176: which paths change what pnpm install runs, beyond the manifests and the lockfile.
 *
 * A manifest that declares an INSTALL_SCRIPTS entry, or has a binding.gyp beside it (pnpm then
 * runs `node-gyp rebuild` itself), runs code from its own directory, and pnpm hands the script
 * every manifest field as npm_package_* variables. An entry file also imports its neighbours,
 * so the gate covers directories, not single files:
 *  - the manifest's directory (for the root manifest, that is every path);
 *  - the directory holding each path a script names (`node ../../tools/setup.mjs` covers tools/).
 * Every changed path under a covered directory needs the dependency row.
 *
 * Every manifest in the repo is read (not only the workspace globs), at the merge base, at the
 * base branch tip (an install script that landed on main after the PR branched still counts)
 * and at the PR head, from the git trees and blobs by sha. Fails closed to [''] (every path):
 * a truncated tree, any fetch or decode problem, a symlinked or unparsable manifest, a
 * package.yaml or package.json5 (the gate cannot parse them), a script that is not a string,
 * a symlink under a covered directory (it can point anywhere), or a script the gate cannot
 * resolve (see scriptTargetDirs: any program other than node or node-gyp, so `pnpm run x`,
 * `pnpm -r`, `--filter`, npx and workspace bins all fail closed; shell expansion, quotes,
 * inline code, a package specifier, an absolute path or one that leaves the repo).
 * Not followed: what the entry file imports from outside the covered directories, and the
 * `<!(...)` command expansions and `sources` of a binding.gyp (docs/SECURITY.md). Never throws.
 * @param {(path: string) => Promise<any>} api GitHub REST GET (injected for tests)
 * @returns {Promise<{ dirs: string[], notes: string[] }>} lowercased directories, '' = every path
 */
export async function installScriptCoverage(repo, pr, api = gh) {
  try {
    return await scanInstallScripts(repo, pr, api);
  } catch (e) {
    return { dirs: [''], notes: [`install scripts: every path counts (${e?.message ?? e})`] };
  }
}

const SHA = /^[0-9a-f]{40}$/;
const MANIFEST = /(^|\/)package\.(json|yaml|json5)$/i;
const ALT_MANIFEST = /(^|\/)package\.(yaml|json5)$/i;
const BINDING_GYP = /(^|\/)binding\.gyp$/i;
/**
 * Characters of a script word the gate can resolve; anything else fails closed. No `@` (a
 * scoped package specifier such as `-r @pwp/core` loads another workspace package), no `:`
 * (data:, file: and node: URLs), no quotes, `$`, globs, `~` or backslashes.
 */
const PLAIN_WORD = /^[A-Za-z0-9._/+=-]*$/;
/**
 * Words after which the gate can no longer tell what runs: inline code in any short-option
 * group holding e, p, c or C (-e, -pe, -ec, -lc, -C) or --eval / --print, and anything that
 * moves the working directory (cd, pushd, --prefix, --dir, --cwd), since later relative paths
 * would then resolve somewhere else.
 */
const OPAQUE_WORD = /^(cd|pushd|-[A-Za-z]*[epcC][A-Za-z]*|--(eval|print|prefix|dir|cwd)(=.*)?)$/;
/**
 * The only programs a command in an install script may start with. Anything else can run
 * code the gate does not see: `pnpm run x` / `npm run x` / `pnpm x` (another script),
 * `pnpm -r`, `--filter` (other packages' scripts), npx / pnpx / dlx, sh -c, a workspace bin.
 */
const PROGRAMS = new Set(['node', 'node-gyp']);
const dirOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

/**
 * Directories (repo-relative) holding the paths an install script command names, for a
 * manifest in `dir` ('' for the root). Each command (split at ;, &&, ||, |, &, parentheses
 * and newlines) must start with a PROGRAMS entry. After it, a bare word (`rebuild`,
 * `setup.mjs`, `tsx`) names no path outside `dir`: it is an option, a file in the covered
 * manifest directory, or an unscoped dependency name, which the lockfile already covers
 * (workspace packages are scoped, and `@` fails closed). Throws when a command cannot be
 * resolved, so the caller fails closed.
 */
export function scriptTargetDirs(dir, command) {
  if (typeof command !== 'string') throw new Error('a script is not a string');
  const out = new Set();
  for (const segment of command.split(/&&|\|\||[;|&()\n]/)) {
    const words = segment.split(/[\s<>]+/).filter(Boolean);
    if (!words.length) continue;
    if (!PROGRAMS.has(words[0]))
      throw new Error(
        `cannot resolve script program ${JSON.stringify(words[0])} (only node and node-gyp)`,
      );
    for (const word of words.slice(1)) {
      if (!PLAIN_WORD.test(word) || OPAQUE_WORD.test(word))
        throw new Error(`cannot resolve script word ${JSON.stringify(word)}`);
      for (const piece of word.split('=')) {
        if (!piece.includes('/') && !piece.startsWith('.')) continue;
        if (piece.startsWith('/')) throw new Error(`absolute path ${piece} in a script`);
        const p = posix.normalize(posix.join(dir || '.', piece)).replace(/\/+$/, '');
        if (p === '..' || p.startsWith('../'))
          throw new Error(`script path ${piece} leaves the repo`);
        out.add(p === '.' ? '' : dirOf(p));
      }
    }
  }
  return [...out];
}

/** Is `f` under one of `dirs` (lowercased, '' = every path)? Case-insensitive, like #162. */
export function coveredByInstallScript(f, dirs) {
  if (!Array.isArray(dirs) || !dirs.length) return false;
  const p = String(f).toLowerCase();
  return dirs.some((d) => d === '' || p === d || p.startsWith(`${d}/`));
}

async function scanInstallScripts(repo, pr, api) {
  const notes = [];
  const pull = await api(`repos/${repo}/pulls/${pr}`);
  const head = pull?.head?.sha;
  const baseRef = pull?.base?.ref;
  const cmp = await api(`repos/${repo}/compare/${pull?.base?.sha}...${head}?per_page=1`);
  const mergeBase = cmp?.merge_base_commit?.sha;
  if (!SHA.test(String(head)) || !SHA.test(String(mergeBase)))
    throw new Error('merge base or head commit unknown');
  if (typeof baseRef !== 'string' || !baseRef) throw new Error('base branch unknown');
  const ref = await api(
    `repos/${repo}/git/ref/heads/${baseRef.split('/').map(encodeURIComponent).join('/')}`,
  );
  const tip = ref?.object?.sha;
  if (ref?.object?.type !== 'commit' || !SHA.test(String(tip)))
    throw new Error('base branch tip unknown');

  const manifests = new Map(); // path -> Set of blob shas seen at any of the commits
  const dirs = new Set();
  const gyps = new Set(); // binding.gyp paths, noted once
  const symlinks = new Set(); // symlink paths at any of the commits
  for (const commit of new Set([mergeBase, tip, head])) {
    const c = await api(`repos/${repo}/git/commits/${commit}`);
    const treeSha = c?.tree?.sha;
    if (!SHA.test(String(treeSha))) throw new Error(`tree of ${commit} unknown`);
    const tree = await api(`repos/${repo}/git/trees/${treeSha}?recursive=1`);
    if (tree?.truncated !== false || !Array.isArray(tree.tree))
      throw new Error(`tree of ${commit} truncated or unreadable`);
    for (const e of tree.tree) {
      const path = e?.path;
      if (typeof path !== 'string' || e.type !== 'blob') continue;
      if (e.mode === '120000') symlinks.add(path);
      if (BINDING_GYP.test(path) && !gyps.has(path)) {
        gyps.add(path);
        dirs.add(dirOf(path));
        notes.push(`${path}: pnpm runs node-gyp, ${dirOf(path) || 'every path'} counts`);
      }
      if (!MANIFEST.test(path)) continue;
      if (ALT_MANIFEST.test(path)) throw new Error(`${path} cannot be parsed`);
      if (e.mode === '120000') throw new Error(`${path} is a symlink`);
      if (!SHA.test(String(e.sha))) throw new Error(`${path} has no blob sha`);
      if (!manifests.has(path)) manifests.set(path, new Set());
      manifests.get(path).add(e.sha);
    }
  }

  const texts = new Map(); // blob sha -> text
  for (const [path, shas] of manifests) {
    const dir = dirOf(path);
    for (const sha of shas) {
      if (!texts.has(sha)) {
        const b = await api(`repos/${repo}/git/blobs/${sha}`);
        if (b?.sha !== sha || b.encoding !== 'base64' || typeof b.content !== 'string')
          throw new Error(`${path}: blob ${sha.slice(0, 7)} unreadable`);
        texts.set(sha, Buffer.from(b.content, 'base64').toString('utf8'));
      }
      let m;
      try {
        m = parseObject(texts.get(sha).replace(/^\uFEFF/, ''));
      } catch (e) {
        throw new Error(`${path}: unparsable (${e.message})`);
      }
      const scripts = m.scripts ?? {};
      if (typeof scripts !== 'object' || Array.isArray(scripts))
        throw new Error(`${path}: scripts is not an object`);
      const declared = INSTALL_SCRIPTS.filter((k) => Object.hasOwn(scripts, k));
      if (!declared.length) continue;
      dirs.add(dir);
      for (const k of declared) for (const d of scriptTargetDirs(dir, scripts[k])) dirs.add(d);
      notes.push(`${path}: declares ${declared.join(', ')}, ${dir || 'every path'} counts`);
    }
  }
  const lower = [...new Set([...dirs].map((d) => d.toLowerCase()))].sort();
  const result = lower.includes('') ? [''] : lower;
  // A symlink under a covered directory can make the install code read any file in the repo.
  for (const l of symlinks)
    if (coveredByInstallScript(l, result))
      throw new Error(`${l} is a symlink under a covered directory`);
  return { dirs: result, notes };
}

/**
 * The PR author and its commits, straight from the pulls API (never the body or labels).
 * Used by touches-guard to recognise genuine Dependabot PRs.
 */
export async function prAuthorAndCommits(repo, pr) {
  const pull = await gh(`repos/${repo}/pulls/${pr}`);
  const commits = [];
  for (let page = 1; ; page++) {
    const batch = await gh(`repos/${repo}/pulls/${pr}/commits?per_page=100&page=${page}`);
    commits.push(
      ...batch.map((c) => ({
        sha: c.sha,
        author: c.author ? { login: c.author.login, type: c.author.type, id: c.author.id } : null,
        committer: c.committer
          ? { login: c.committer.login, type: c.committer.type, id: c.committer.id }
          : null,
        verified:
          c.commit?.verification?.verified === true && c.commit?.verification?.reason === 'valid',
      })),
    );
    if (batch.length < 100) break;
  }
  assertNotTruncated('commits', commits.length, COMMITS_CAP);
  const u = pull.user ?? {};
  return { user: { login: u.login, type: u.type, id: u.id }, commits };
}

/**
 * The whole gate for one PR, as the CLI runs it: files and labels, the manifest proofs, the
 * install-script coverage (#176), then evaluate(). Exported so a test can drive it end to end
 * with a fake API and prove every input reaches evaluate().
 * @param {(path: string) => Promise<any>} [api] GitHub REST GET
 * @param {{ log?: (s: string) => void, error?: (s: string) => void }} [out]
 * @returns {Promise<number>} the exit code: 0 when every required approval is present
 */
export async function runGate(
  repo,
  pr,
  api = gh,
  { log = console.log, error = console.error } = {},
) {
  let files, apiFiles, labels;
  try {
    ({ files, apiFiles, labels } = await prFilesAndLabels(repo, pr, api));
  } catch (e) {
    error(e.message);
    return 1;
  }
  const { noDependencyChange, notes } = await manifestProofs(repo, pr, apiFiles, api);
  const install = await installScriptCoverage(repo, pr, api);
  for (const n of [...notes, ...install.notes]) log(`· ${n}`);
  const r = evaluate(files, labels, { noDependencyChange, installScriptDirs: install.dirs });
  for (const [a, reasons] of r.required)
    log(`${labels.includes(a) ? '✓' : '✗'} ${a}\n    ${reasons.join('\n    ')}`);
  if (r.blocking) error('\n✗ security:blocking is set. Only the Security Reviewer can lift it.');
  if (r.missing.length || r.blocking) return 1;
  log('\nreview-gate: OK');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const repo = process.env.GITHUB_REPOSITORY;
  const pr = process.argv[2] ?? process.env.PR_NUMBER;
  if (!repo || !pr) {
    console.error('usage: GITHUB_REPOSITORY=owner/repo GITHUB_TOKEN=… review-gate <pr-number>');
    process.exit(2);
  }
  process.exitCode = await runGate(repo, pr);
}
