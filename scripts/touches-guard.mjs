#!/usr/bin/env node
// touches-guard (AGENTS.md §6): fails if a PR changes files outside the "Touches"
// globs of the issue it closes.
import { pathToFileURL } from 'node:url';
import { matchesAny } from './lib/glob.mjs';
import { prFilesAndLabels } from './review-gate.mjs';

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

async function issueBody(repo, n) {
  const res = await fetch(`https://api.github.com/repos/${repo}/issues/${n}`, {
    headers: { authorization: `Bearer ${process.env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error(`issue #${n}: ${res.status}`);
  return (await res.json()).body ?? '';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const repo = process.env.GITHUB_REPOSITORY;
  const pr = process.argv[2] ?? process.env.PR_NUMBER;
  if (!repo || !pr) { console.error('usage: GITHUB_REPOSITORY=owner/repo GITHUB_TOKEN=… touches-guard <pr-number>'); process.exit(2); }
  const { files, body } = await prFilesAndLabels(repo, pr);
  const n = closedIssue(body);
  if (!n) { console.error('✗ PR body has no "Closes #<issue>". Every PR must close an issue (PROMPT.md §12.1).'); process.exit(1); }
  const globs = parseTouches(await issueBody(repo, n));
  if (!globs.length) { console.error(`✗ Issue #${n} has no Touches globs (backticked paths under "## Touches").`); process.exit(1); }
  const bad = outside(files, globs);
  if (bad.length) {
    console.error(`✗ ${bad.length} file(s) outside the Touches of #${n} (${globs.join(', ')}):`);
    for (const f of bad) console.error(`    ${f}`);
    process.exit(1);
  }
  console.log(`touches-guard: OK (${files.length} files within #${n})`);
}
