#!/usr/bin/env node
// review-gate (PROMPT.md §11.2): compares a PR's changed paths and labels with the
// review matrix and fails if a required approved:<role> label is missing.
// The signed APPROVED comment is checked by the Orchestrator (one shared account, Q10.6).
import { pathToFileURL } from 'node:url';
import { matchesAny } from './lib/glob.mjs';

/**
 * ADR 0002 Enforcement (c), #81: the rich-text chokepoint and the checks that guard it.
 * Every change here needs approved:security, whatever other rows say (#93 may narrow the
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
    when: (f) =>
      matchesAny(f, [
        'pnpm-lock.yaml',
        'package.json',
        'packages/*/package.json',
        'playground/package.json',
        'pnpm-workspace.yaml',
        '.npmrc',
      ]),
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

/** @returns {{ required: Map<string,string[]>, missing: {label:string, reasons:string[]}[], blocking: boolean }} */
export function evaluate(files, labels) {
  const required = new Map();
  for (const row of MATRIX) {
    const hits = row.id === 'peer' ? ['(any)'] : files.filter((f) => row.when(f, labels));
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
  let raw = 0;
  for (let page = 1; ; page++) {
    const batch = await gh(`repos/${repo}/pulls/${pr}/files?per_page=100&page=${page}`);
    raw += batch.length;
    files.push(...changedPaths(batch));
    if (batch.length < 100) break;
  }
  assertNotTruncated('files', raw, FILES_CAP);
  const issue = await gh(`repos/${repo}/issues/${pr}`);
  return { files, labels: issue.labels.map((l) => l.name), body: issue.body ?? '' };
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
  let files, labels;
  try {
    ({ files, labels } = await prFilesAndLabels(repo, pr));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  const r = evaluate(files, labels);
  for (const [a, reasons] of r.required)
    console.log(`${labels.includes(a) ? '✓' : '✗'} ${a}\n    ${reasons.join('\n    ')}`);
  if (r.blocking)
    console.error('\n✗ security:blocking is set. Only the Security Reviewer can lift it.');
  if (r.missing.length || r.blocking) process.exit(1);
  console.log('\nreview-gate: OK');
}
