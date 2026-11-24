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
// Touches come only from a trusted issue (#150): AGENTS.md §6 says the Orchestrator sets them, so
// the issue must carry an `agent:*` label (only triage/write users can set labels) and have
// author_association OWNER, MEMBER or COLLABORATOR (no hard-coded logins). fetchIssue refuses
// redirects (a transferred issue answers 301 to another repo) and checks repository_url and number.
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

/**
 * Markdown with fenced code blocks removed (#148). Text inside a fence is an example, not
 * content, so a fenced "## Touches" or "Closes #n" must never decide the result. A fence opens
 * with 3 or more backticks or tildes (up to 3 leading spaces; a backtick fence's info string may
 * not contain a backtick) and closes with the same character, at least as many times, alone on its
 * line. An unclosed fence runs to the end of the body (fail closed). Removed lines become blank
 * lines, so the text around a fence stays separated.
 */
export function stripFences(text) {
  const out = [];
  let fence = null; // { ch, len } while inside a fence
  for (const line of String(text ?? '').split(/\r\n|\r|\n/)) {
    if (fence) {
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
      if (close && close[1][0] === fence.ch && close[1].length >= fence.len) fence = null;
      out.push('');
      continue;
    }
    const open = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (open && !(open[1][0] === '`' && open[2].includes('`'))) {
      fence = { ch: open[1][0], len: open[1].length };
      out.push('');
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

/** Columns of leading whitespace (a tab advances to the next multiple of 4, as in CommonMark). */
function indentWidth(line) {
  let col = 0;
  for (const ch of line) {
    if (ch === ' ') col += 1;
    else if (ch === '\t') col += 4 - (col % 4);
    else break;
  }
  return col;
}

/**
 * Markdown with fenced code blocks, indented code and blockquotes removed (#148, #191): only
 * "plain" lines are left. A line indented 4 or more columns is dropped (indented code, or a
 * deeply nested list continuation; dropping both fails closed). A line whose first character
 * after up to 3 spaces is `>` starts a blockquote, and every following non-blank line is dropped
 * too until a blank line, because Markdown continues a quoted paragraph lazily onto unmarked
 * lines. Removed lines become blank lines.
 */
export function plainLines(text) {
  let quoted = false;
  return stripFences(text)
    .split('\n')
    .map((line) => {
      if (!line.trim()) {
        quoted = false;
        return line;
      }
      if (/^ {0,3}>/.test(line)) quoted = true;
      if (quoted || indentWidth(line) >= 4) return '';
      return line;
    })
    .join('\n');
}

/**
 * Issue number from the first "Closes/Fixes/Resolves #n" in a PR body, on a plain line: never
 * inside a fenced or indented code block or a blockquote (#148, #191).
 */
export function closedIssue(body) {
  const m = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)\b/i.exec(plainLines(body));
  return m ? Number(m[1]) : null;
}

/** A Markdown list item (`-`, `*`, `+`, `1.` or `1)`, up to 3 leading spaces): its text. */
const LIST_ITEM = /^ {0,3}(?:[-*+]|\d{1,9}[.)])[ \t]+(.*)$/;

/**
 * Backticked globs from the "## Touches" section (markdown) or the "### Touches" issue-form
 * section, ignoring fenced code blocks (#148). Globs are read only from list items, one or more
 * inline code spans on the item's own line; prose, quoted, indented and continuation lines are
 * ignored, and a code span never crosses a line break (#191).
 */
export function parseTouches(body) {
  const m = /^#{2,3}\s*Touches\s*$([\s\S]*?)(?=^#{2,3}\s|(?![\s\S]))/im.exec(stripFences(body));
  if (!m) return [];
  return m[1]
    .split('\n')
    .map((line) => LIST_ITEM.exec(line)?.[1] ?? '')
    .flatMap((item) => [...item.matchAll(/`([^`\n]+)`/g)].map((x) => x[1].trim()))
    .filter(Boolean);
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

/** author_association values trusted to define Touches (#150): people with a role in the repo. */
export const TRUSTED_ASSOCIATIONS = Object.freeze(['OWNER', 'MEMBER', 'COLLABORATOR']);

/** Label names from the issues API (objects with `name`, or plain strings). */
function labelNames(labels) {
  if (!Array.isArray(labels)) return [];
  return labels
    .map((l) => (typeof l === 'string' ? l : l && typeof l.name === 'string' ? l.name : ''))
    .filter(Boolean);
}

/**
 * Normalise what `issueBody(n)` returned: the issues API object (or, in old tests, only a
 * string body, which carries no labels or author and so is never trusted).
 * @returns {{ body: string, isPullRequest: boolean, labels: string[], association: string }}
 */
function asIssue(x) {
  if (typeof x === 'string') return { body: x, isPullRequest: false, labels: [], association: '' };
  if (!x || typeof x !== 'object') {
    return { body: '', isPullRequest: false, labels: [], association: '' };
  }
  return {
    body: typeof x.body === 'string' ? x.body : '',
    isPullRequest: x.pull_request != null,
    labels: labelNames(x.labels),
    association: typeof x.author_association === 'string' ? x.author_association : '',
  };
}

/** Why #n may not define Touches (#150), or [] when it may. */
function untrusted(n, issue) {
  const lines = [];
  if (!issue.labels.some((l) => /^agent:\S+$/.test(l))) {
    lines.push(
      `✗ Issue #${n} has no agent:* label. Touches are trusted only on an issue the Orchestrator ` +
        'assigned (AGENTS.md §6): add an agent:<id> label to the issue, then re-run this check.',
    );
  }
  if (!TRUSTED_ASSOCIATIONS.includes(issue.association)) {
    lines.push(
      `✗ Issue #${n} was opened by an author with association ${issue.association || '(none)'}; ` +
        `Touches are trusted only from ${TRUSTED_ASSOCIATIONS.join(', ')}. Ask the Orchestrator to ` +
        'open the issue (or copy it into a new one) and close that issue instead.',
    );
  }
  return lines;
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
 *   issueBody: (n: number) => Promise<string | IssueObject> | string | IssueObject,
 * }} pr
 * @typedef {{ body?: string | null, pull_request?: unknown, labels?: unknown[],
 *   author_association?: string }} IssueObject
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
  const distrust = untrusted(n, issue);
  if (distrust.length) return { ok: false, lines: distrust };
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

/**
 * The issues API object for #n (pull requests come back too, with a `pull_request` key).
 * Fails closed (#150) on any redirect (a transferred issue answers 301 to another repository),
 * and when the returned object is not issue #n of `repo`.
 */
export async function fetchIssue(repo, n) {
  let res;
  try {
    res = await fetch(`https://api.github.com/repos/${repo}/issues/${n}`, {
      redirect: 'error',
      headers: {
        authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        accept: 'application/vnd.github+json',
      },
    });
  } catch (e) {
    throw new Error(
      `✗ issue #${n}: request failed or was redirected (${e?.message ?? e}). A transferred ` +
        `issue answers with a redirect to another repository and is refused: close an issue in ${repo}.`,
      { cause: e },
    );
  }
  if (res.status >= 300 && res.status < 400) {
    throw new Error(
      `✗ issue #${n}: redirected (HTTP ${res.status}); it was probably transferred out of ${repo}. ` +
        `Close an issue in ${repo}.`,
    );
  }
  if (!res.ok) throw new Error(`✗ issue #${n}: HTTP ${res.status}`);
  const issue = await res.json();
  const want = `https://api.github.com/repos/${repo}`.toLowerCase();
  const got = typeof issue?.repository_url === 'string' ? issue.repository_url : '';
  if (got.toLowerCase() !== want) {
    throw new Error(
      `✗ issue #${n}: repository_url is ${got || '(missing)'}, not ${repo}. Touches are read only ` +
        `from issues in ${repo}; close an issue in this repository.`,
    );
  }
  if (Number(issue.number) !== Number(n)) {
    throw new Error(`✗ issue #${n}: the API returned #${issue.number ?? '(none)'} instead.`);
  }
  return issue;
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
  let r;
  try {
    r = await evaluateTouches({
      user,
      commits,
      files,
      body,
      number: pr,
      issueBody: (n) => fetchIssue(repo, n),
    });
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  for (const l of r.lines) (r.ok ? console.log : console.error)(l);
  if (!r.ok) process.exit(1);
}
