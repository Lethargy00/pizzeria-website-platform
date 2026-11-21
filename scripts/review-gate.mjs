#!/usr/bin/env node
// review-gate (PROMPT.md §11.2): compares a PR's changed paths and labels with the
// review matrix and fails if a required approved:<role> label is missing.
// The signed APPROVED comment is checked by the Orchestrator (one shared account, Q10.6).
import { Buffer } from 'node:buffer';
import { pathToFileURL } from 'node:url';
import { matchesAny } from './lib/glob.mjs';

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

/** Always a dependency change when touched: the lockfile and the root / playground manifests. */
export const DEPENDENCY_PATHS = [
  'pnpm-lock.yaml',
  'package.json',
  'playground/package.json',
  'pnpm-workspace.yaml',
  '.npmrc',
];

/** Workspace package manifests: a dependency change only if a DEPENDENCY_FIELDS value differs. */
export const PACKAGE_MANIFESTS = 'packages/*/package.json';

/**
 * Top-level package.json fields that decide what gets installed, how, or with which engine.
 * The #93 list, plus the fields next to it that pnpm or npm also read when installing.
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
];

/** Install-time lifecycle scripts: pnpm install runs these, so they count as dependency changes. */
export const INSTALL_SCRIPTS = [
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
 * Which dependency fields differ between two package.json texts. Fails closed: if either side
 * is not a string, does not parse, or is not a JSON object, the answer is "changed".
 * Key order counts as a change too (JSON.stringify), which can only ask for more review.
 * @returns {{ changed: boolean, why: string }}
 */
export function dependencyFieldsChanged(baseText, headText) {
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
      matchesAny(f, [
        'packages/schema/**',
        'packages/*/src/contracts/**',
        'packages/adapters/src/interfaces/**',
        'scripts/boundaries.json',
        'docs/adr/**',
        'packages/*/package.json',
      ]),
  },
  {
    id: 'dependency',
    approval: ['approved:architect', 'approved:security'],
    why: 'dependency change (also link an approved type:dependency issue)',
    // #93: a packages/*/package.json is skipped only when the gate has PROVEN that none of its
    // DEPENDENCY_FIELDS changed (ctx.noDependencyChange). Without that proof it matches, as before.
    when: (f, _labels, ctx = {}) =>
      matchesAny(f, DEPENDENCY_PATHS) ||
      (matchesAny(f, [PACKAGE_MANIFESTS]) && !ctx.noDependencyChange?.has(f)),
  },
  {
    id: 'security',
    approval: 'approved:security',
    why: 'security-sensitive path',
    when: (f, labels) =>
      labels.includes('security:sensitive') ||
      matchesAny(f, [
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
        '**/.env.example',
        'SECURITY.md',
        'docs/SECURITY.md',
        'docs/THREAT-MODEL.md',
        '.github/CODEOWNERS',
      ]),
  },
  {
    id: 'richtext',
    approval: 'approved:security',
    why: 'rich-text chokepoint or its checks (ADR 0002 (c))',
    when: (f) => matchesAny(f, RICHTEXT_PATHS),
  },
  {
    id: 'a11y-perf',
    approval: 'approved:a11y-perf',
    why: 'user-visible change',
    when: (f) =>
      matchesAny(f, [
        'packages/ui/**',
        'packages/themes/**',
        'packages/tokens/**',
        'playground/**',
      ]),
  },
];

/**
 * @returns {{ required: Map<string,string[]>, missing: {label:string, reasons:string[]}[], blocking: boolean }}
 * @param {string[]} files changed paths
 * @param {string[]} labels PR labels
 * @param {{ noDependencyChange?: Set<string> }} [ctx] manifests proven free of dependency
 *   changes (see manifestProofs). Leave it out and every manifest counts as a dependency change.
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

export async function prFilesAndLabels(repo, pr) {
  const files = [];
  const apiFiles = [];
  for (let page = 1; ; page++) {
    const batch = await gh(`repos/${repo}/pulls/${pr}/files?per_page=100&page=${page}`);
    apiFiles.push(...batch);
    files.push(...changedPaths(batch));
    if (batch.length < 100) break;
  }
  assertNotTruncated('files', apiFiles.length, FILES_CAP);
  const issue = await gh(`repos/${repo}/issues/${pr}`);
  return { files, apiFiles, labels: issue.labels.map((l) => l.name), body: issue.body ?? '' };
}

/** The contents API inlines files up to 1 MB as base64; anything else is "unavailable". */
export function decodeContents(entry) {
  if (entry?.type !== 'file' || entry.encoding !== 'base64' || typeof entry.content !== 'string')
    return undefined;
  return Buffer.from(entry.content, 'base64').toString('utf8');
}

/**
 * #93: for each modified workspace manifest (PACKAGE_MANIFESTS), compare its dependency fields at the merge
 * base and at the PR head. Returns the paths PROVEN unchanged, plus a note per manifest.
 * Fails closed: an added, removed, renamed or copied manifest, a missing merge base, or any
 * fetch / decode / parse problem leaves the path out of the set, so the dependency row applies.
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
      r = dependencyFieldsChanged(decodeContents(b), decodeContents(h));
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const repo = process.env.GITHUB_REPOSITORY;
  const pr = process.argv[2] ?? process.env.PR_NUMBER;
  if (!repo || !pr) {
    console.error('usage: GITHUB_REPOSITORY=owner/repo GITHUB_TOKEN=… review-gate <pr-number>');
    process.exit(2);
  }
  let files, apiFiles, labels;
  try {
    ({ files, apiFiles, labels } = await prFilesAndLabels(repo, pr));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  const { noDependencyChange, notes } = await manifestProofs(repo, pr, apiFiles);
  for (const n of notes) console.log(`· ${n}`);
  const r = evaluate(files, labels, { noDependencyChange });
  for (const [a, reasons] of r.required)
    console.log(`${labels.includes(a) ? '✓' : '✗'} ${a}\n    ${reasons.join('\n    ')}`);
  if (r.blocking)
    console.error('\n✗ security:blocking is set. Only the Security Reviewer can lift it.');
  if (r.missing.length || r.blocking) process.exit(1);
  console.log('\nreview-gate: OK');
}
