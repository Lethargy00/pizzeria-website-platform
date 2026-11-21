#!/usr/bin/env node
// touches-guard (AGENTS.md §6): fails if a PR changes files outside the "Touches"
// globs of the issue it closes.
// Dependabot exception (#59): a PR authored by the real dependabot[bot] app (identity from the
// pulls API, never the body or labels) needs no "Closes #n", but may only change dependency
// manifests, the lockfile or top-level workflow files (.github/workflows/*.yml|yaml); renames
// are checked by both old and new path. Files or commits at the API list cap fail closed.
//
// Commit check: every commit must have author dependabot[bot] (49699333), committer web-flow
// (19864447) and a valid signature. This raises the bar but CANNOT prove Dependabot wrote a
// commit: a user with write access can create a web-flow-signed commit through the Contents or
// Git Data API with the bot's noreply address as author, and it passes. The real defence is the
// path allow-list above plus the full review-gate matrix, which still requires approved:peer,
// approved:security on every Dependabot PR, and approved:architect for dependency files.
//
// Touches come only from a real issue (#131): the issues API also returns pull requests, so a
// "Closes #n" that names this PR itself, or any object with a `pull_request` key, fails closed
// before any Touches are read. Otherwise a PR author could grant itself `**` in its own body.
//
// Maintainers: "Update branch" (or any manual push) on a Dependabot PR adds a commit that is not
// Dependabot's and breaks this check. Comment `@dependabot recreate` instead.
import { pathToFileURL } from 'node:url';
import { matchesAny } from './lib/glob.mjs';
import { prFilesAndLabels, prAuthorAndCommits } from './review-gate.mjs';

/** GitHub's fixed identity for the Dependabot app. `[bot]` logins cannot be registered by users. */
export const DEPENDABOT = Object.freeze({ login: 'dependabot[bot]', type: 'Bot', id: 49699333 });

/** The committer GitHub records for Dependabot's (and other web-UI/API) commits. */
export const WEB_FLOW = Object.freeze({ login: 'web-flow', id: 19864447 });

/** True only for the web-flow committer identity from the API (login and id must match). */
export function isWebFlow(user) {
  return !!user && user.login === WEB_FLOW.login && user.id === WEB_FLOW.id;
}

/** Files a Dependabot PR may change: npm manifests + lockfile, and workflows (github-actions). */
export const DEPENDABOT_FILES = Object.freeze([
  'package.json',
  'packages/*/package.json',
  'playground/package.json',
  'pnpm-lock.yaml',
  '.github/workflows/*.{yml,yaml}',
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
  const foreign = commits.filter(
    (c) => !isDependabot(c.author) || !isWebFlow(c.committer) || c.verified !== true,
  );
  if (foreign.length) {
    lines.push(
      `✗ ${foreign.length} commit(s) not authored by dependabot[bot], committed by web-flow and validly ` +
        'signed. Someone pushed to the Dependabot branch (e.g. "Update branch"): comment ' +
        '"@dependabot recreate" instead, or open a normal PR that closes an issue:',
      ...foreign.map(
        (c) =>
          `    ${String(c.sha ?? '').slice(0, 7)} author ${c.author?.login ?? '(unknown)'}, ` +
          `committer ${c.committer?.login ?? '(unknown)'}${c.verified === true ? '' : ' (unverified)'}`,
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
 * Normalise what `issueBody(n)` returned: a string (the body) or the issues API object.
 * @returns {{ body: string, isPullRequest: boolean }}
 */
function asIssue(x) {
  if (typeof x === 'string') return { body: x, isPullRequest: false };
  if (!x || typeof x !== 'object') return { body: '', isPullRequest: false };
  return {
    body: typeof x.body === 'string' ? x.body : '',
    isPullRequest: x.pull_request != null,
  };
}

/**
 * Pure decision for one PR. `user` and `commits` must come from the pulls API.
 * `number` is this PR's number; `issueBody(n)` returns the issues API object for #n (or only
 * its body as a string, in tests).
 * @param {{
 *   user: { login?: string, type?: string, id?: number } | null,
 *   commits?: { sha: string, author: { login?: string, type?: string, id?: number } | null,
 *               committer?: { login?: string, type?: string, id?: number } | null, verified: boolean }[],
 *   files: string[],
 *   body: string,
 *   number?: number | string,
 *   issueBody: (n: number) => Promise<string | { body?: string | null, pull_request?: unknown }>
 *     | string | { body?: string | null, pull_request?: unknown },
 * }} pr
 * @returns {Promise<{ ok: boolean, lines: string[] }>}
 */
export async function evaluateTouches({ user, commits = [], files, body, number, issueBody }) {
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
  if (number != null && Number(number) === n) {
    return {
      ok: false,
      lines: [
        `✗ "Closes #${n}" names this pull request itself. Close the issue that defines the ` +
          'Touches (AGENTS.md §6), not the PR.',
      ],
    };
  }
  const issue = asIssue(await issueBody(n));
  if (issue.isPullRequest) {
    return {
      ok: false,
      lines: [
        `✗ #${n} is a pull request, not an issue. Touches must come from the issue the PR ` +
          'closes (AGENTS.md §6).',
      ],
    };
  }
  const globs = parseTouches(issue.body);
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

/** The issues API object for #n (pull requests come back too, with a `pull_request` key). */
export async function fetchIssue(repo, n) {
  const res = await fetch(`https://api.github.com/repos/${repo}/issues/${n}`, {
    headers: {
      authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      accept: 'application/vnd.github+json',
    },
  });
  if (!res.ok) throw new Error(`issue #${n}: ${res.status}`);
  return await res.json();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const repo = process.env.GITHUB_REPOSITORY;
  const pr = process.argv[2] ?? process.env.PR_NUMBER;
  if (!repo || !pr) {
    console.error('usage: GITHUB_REPOSITORY=owner/repo GITHUB_TOKEN=… touches-guard <pr-number>');
    process.exit(2);
  }
  let files, body, user, commits;
  try {
    ({ files, body } = await prFilesAndLabels(repo, pr));
    ({ user, commits } = await prAuthorAndCommits(repo, pr));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  const r = await evaluateTouches({
    user,
    commits,
    files,
    body,
    number: pr,
    issueBody: (n) => fetchIssue(repo, n),
  });
  for (const l of r.lines) (r.ok ? console.log : console.error)(l);
  if (!r.ok) process.exit(1);
}
