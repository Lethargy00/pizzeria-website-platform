#!/usr/bin/env node
// touches-guard (AGENTS.md §6): fails if a PR changes files outside the "Touches"
// globs of the issue it closes.
// Dependabot exception (#59): a PR authored by the real dependabot[bot] app (identity from the
// pulls API, never the body or labels) needs no "Closes #n", but may only change dependency
// manifests, the lockfile or workflow files, and every commit must be Dependabot's own signed
// commit. review-gate still requires approved:architect + approved:security for these files.
import { pathToFileURL } from 'node:url';
import { matchesAny } from './lib/glob.mjs';
import { prFilesAndLabels, prAuthorAndCommits } from './review-gate.mjs';

/** GitHub's fixed identity for the Dependabot app. `[bot]` logins cannot be registered by users. */
export const DEPENDABOT = Object.freeze({ login: 'dependabot[bot]', type: 'Bot', id: 49699333 });

/** Files a Dependabot PR may change: npm manifests + lockfile, and workflows (github-actions). */
export const DEPENDABOT_FILES = Object.freeze([
  'package.json',
  'packages/*/package.json',
  'playground/package.json',
  'pnpm-lock.yaml',
  '.github/workflows/**',
]);

/** True only for the API identity of the Dependabot app (login, type and id must all match). */
export function isDependabot(user) {
  return (
    !!user &&
    user.login === DEPENDABOT.login &&
    user.type === DEPENDABOT.type &&
    user.id === DEPENDABOT.id
  );
}

/** Issue number from the first "Closes/Fixes/Resolves #n" in a PR body. */
export function closedIssue(body) {
  const m = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)\b/i.exec(body ?? '');
  return m ? Number(m[1]) : null;
}

/** Backticked globs from the "## Touches" section (markdown) or the "### Touches" issue-form section. */
export function parseTouches(body) {
  const m = /^#{2,3}\s*Touches\s*$([\s\S]*?)(?=^#{2,3}\s|(?![\s\S]))/im.exec(body ?? '');
  if (!m) return [];
  return [...m[1].matchAll(/`([^`]+)`/g)].map((x) => x[1].trim()).filter(Boolean);
}

export function outside(files, globs) {
  return files.filter((f) => !matchesAny(f, globs));
}

function dependabotVerdict(files, commits) {
  const lines = [];
  if (!files.length) lines.push('✗ Dependabot PR changes no files.');
  const bad = outside(files, DEPENDABOT_FILES);
  if (bad.length) {
    lines.push(
      `✗ Dependabot PR changes ${bad.length} file(s) outside the dependency allow-list (${DEPENDABOT_FILES.join(', ')}):`,
      ...bad.map((f) => `    ${f}`),
    );
  }
  if (!commits.length) lines.push('✗ Dependabot PR has no commits to check.');
  const foreign = commits.filter((c) => !isDependabot(c.author) || c.verified !== true);
  if (foreign.length) {
    lines.push(
      `✗ ${foreign.length} commit(s) not authored and signed by dependabot[bot]. Someone pushed to ` +
        'the Dependabot branch: use "@dependabot recreate" instead, or open a normal PR that closes an issue:',
      ...foreign.map(
        (c) =>
          `    ${String(c.sha ?? '').slice(0, 7)} by ${c.author?.login ?? '(unknown)'}${c.verified === true ? '' : ' (unverified)'}`,
      ),
    );
  }
  if (lines.length) return { ok: false, lines };
  return {
    ok: true,
    lines: [
      `touches-guard: OK (Dependabot PR, ${files.length} dependency file(s); ` +
        'review-gate still applies its full matrix)',
    ],
  };
}

/**
 * Pure decision for one PR. `user` and `commits` must come from the pulls API.
 * @param {{
 *   user: { login?: string, type?: string, id?: number } | null,
 *   commits?: { sha: string, author: { login?: string, type?: string, id?: number } | null, verified: boolean }[],
 *   files: string[],
 *   body: string,
 *   issueBody: (n: number) => Promise<string> | string,
 * }} pr
 * @returns {Promise<{ ok: boolean, lines: string[] }>}
 */
export async function evaluateTouches({ user, commits = [], files, body, issueBody }) {
  if (isDependabot(user)) return dependabotVerdict(files, commits);
  const n = closedIssue(body);
  if (!n) {
    return {
      ok: false,
      lines: [
        '✗ PR body has no "Closes #<issue>". Every PR must close an issue (PROMPT.md §12.1).',
      ],
    };
  }
  const globs = parseTouches(await issueBody(n));
  if (!globs.length) {
    return {
      ok: false,
      lines: [`✗ Issue #${n} has no Touches globs (backticked paths under "## Touches").`],
    };
  }
  const bad = outside(files, globs);
  if (bad.length) {
    return {
      ok: false,
      lines: [
        `✗ ${bad.length} file(s) outside the Touches of #${n} (${globs.join(', ')}):`,
        ...bad.map((f) => `    ${f}`),
      ],
    };
  }
  return { ok: true, lines: [`touches-guard: OK (${files.length} files within #${n})`] };
}

async function issueBody(repo, n) {
  const res = await fetch(`https://api.github.com/repos/${repo}/issues/${n}`, {
    headers: {
      authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      accept: 'application/vnd.github+json',
    },
  });
  if (!res.ok) throw new Error(`issue #${n}: ${res.status}`);
  return (await res.json()).body ?? '';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const repo = process.env.GITHUB_REPOSITORY;
  const pr = process.argv[2] ?? process.env.PR_NUMBER;
  if (!repo || !pr) {
    console.error('usage: GITHUB_REPOSITORY=owner/repo GITHUB_TOKEN=… touches-guard <pr-number>');
    process.exit(2);
  }
  const { files, body } = await prFilesAndLabels(repo, pr);
  const { user, commits } = await prAuthorAndCommits(repo, pr);
  const r = await evaluateTouches({
    user,
    commits,
    files,
    body,
    issueBody: (n) => issueBody(repo, n),
  });
  for (const l of r.lines) (r.ok ? console.log : console.error)(l);
  if (!r.ok) process.exit(1);
}
