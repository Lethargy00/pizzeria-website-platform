#!/usr/bin/env node
// review-gate (PROMPT.md §11.2): compares a PR's changed paths and labels with the
// review matrix and fails if a required approved:<role> label is missing.
// The signed APPROVED comment is checked by the Orchestrator (one shared account, Q10.6).
import { pathToFileURL } from 'node:url';
import { matchesAny } from './lib/glob.mjs';

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

export async function prFilesAndLabels(repo, pr) {
  const files = [];
  for (let page = 1; ; page++) {
    const batch = await gh(`repos/${repo}/pulls/${pr}/files?per_page=100&page=${page}`);
    files.push(...batch.map((f) => f.filename));
    if (batch.length < 100) break;
  }
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
        verified: c.commit?.verification?.verified === true,
      })),
    );
    if (batch.length < 100) break;
  }
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
  const { files, labels } = await prFilesAndLabels(repo, pr);
  const r = evaluate(files, labels);
  for (const [a, reasons] of r.required)
    console.log(`${labels.includes(a) ? '✓' : '✗'} ${a}\n    ${reasons.join('\n    ')}`);
  if (r.blocking)
    console.error('\n✗ security:blocking is set. Only the Security Reviewer can lift it.');
  if (r.missing.length || r.blocking) process.exit(1);
  console.log('\nreview-gate: OK');
}
