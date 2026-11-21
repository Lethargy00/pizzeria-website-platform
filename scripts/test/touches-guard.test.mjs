// #131: touches-guard takes Touches only from a real issue, never from a pull request
// (the issues API also returns PRs, marked by a `pull_request` key).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateTouches, fetchIssue } from '../touches-guard.mjs';

const HUMAN = { login: 'Wetterbro', type: 'User', id: 47597724 };
const BOT = { login: 'dependabot[bot]', type: 'Bot', id: 49699333 };
const WEBFLOW = { login: 'web-flow', type: 'User', id: 19864447 };
const WIDE = 'Closes #200\n## Touches\n- `**`\n';
const PR_KEY = { url: 'https://api.github.com/repos/o/r/pulls/200' };

// What the issues API returns: #50 is an issue, #200 and #201 are pull requests.
const api = {
  50: { number: 50, body: '## Touches\n- `scripts/**`\n' },
  200: { number: 200, body: WIDE, pull_request: PR_KEY },
  201: { number: 201, body: '## Touches\n- `**`\n', pull_request: PR_KEY },
};
const issueBody = (n) => api[n] ?? { number: n, body: '' };
const run = (pr) => evaluateTouches({ user: HUMAN, issueBody, ...pr });

test('self-referencing PR (Closes its own number) fails before any issue is read', async () => {
  let reads = 0;
  const r = await run({
    number: 200,
    body: WIDE,
    files: ['package.json', 'scripts/review-gate.mjs'],
    issueBody: (n) => {
      reads++;
      return issueBody(n);
    },
  });
  assert.equal(r.ok, false, r.lines.join('\n'));
  assert.match(r.lines[0], /names this pull request itself/);
  assert.equal(reads, 0);
});

test('self-reference is caught when the PR number is a string (CLI argv)', async () => {
  const r = await run({ number: '200', body: WIDE, files: ['a'] });
  assert.equal(r.ok, false);
  assert.match(r.lines[0], /names this pull request itself/);
});

test('self-referencing PR fails on the pull_request key even without a PR number', async () => {
  const r = await run({ body: WIDE, files: ['package.json'] });
  assert.equal(r.ok, false);
  assert.match(r.lines[0], /#200 is a pull request/);
});

test('reference to another PR with broad Touches fails', async () => {
  const r = await run({ number: 300, body: 'Fixes #201', files: ['scripts/a.mjs'] });
  assert.equal(r.ok, false, r.lines.join('\n'));
  assert.match(r.lines[0], /#201 is a pull request, not an issue/);
});

test('any non-null pull_request value marks a PR (async fetch too)', async () => {
  for (const pull_request of [{}, 'x', 0, false]) {
    const r = await run({
      number: 300,
      body: 'Closes #201',
      files: ['a'],
      issueBody: async () => ({ body: '## Touches\n- `**`\n', pull_request }),
    });
    assert.equal(r.ok, false, JSON.stringify(pull_request));
    assert.match(r.lines[0], /#201 is a pull request/);
  }
});

test('a real issue still works: inside Touches passes, outside fails', async () => {
  const ok = await run({ number: 300, body: 'Closes #50', files: ['scripts/a.mjs'] });
  assert.equal(ok.ok, true, ok.lines.join('\n'));
  assert.match(ok.lines[0], /within #50/);
  const bad = await run({ number: 300, body: 'Closes #50', files: ['package.json'] });
  assert.equal(bad.ok, false);
});

test('pull_request: null or absent is an issue; a null body means no Touches', async () => {
  const asNull = await run({
    number: 300,
    body: 'Closes #50',
    files: ['scripts/a.mjs'],
    issueBody: () => ({ ...api[50], pull_request: null }),
  });
  assert.equal(asNull.ok, true, asNull.lines.join('\n'));
  const noBody = await run({
    number: 300,
    body: 'Closes #50',
    files: ['scripts/a.mjs'],
    issueBody: () => ({ body: null }),
  });
  assert.equal(noBody.ok, false);
  assert.match(noBody.lines[0], /no Touches globs/);
});

test('Dependabot path is unchanged by the PR checks', async () => {
  const r = await evaluateTouches({
    user: BOT,
    number: 200,
    commits: [{ sha: 'a'.repeat(40), author: BOT, committer: WEBFLOW, verified: true }],
    files: ['pnpm-lock.yaml'],
    body: 'Bumps x.',
    issueBody: () => assert.fail('must not read an issue'),
  });
  assert.equal(r.ok, true, r.lines.join('\n'));
});

test('fetchIssue returns the whole issues API object, so the pull_request key survives', async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(new URL(url).pathname);
    return { ok: true, status: 200, json: async () => api[201] };
  };
  try {
    const r = await evaluateTouches({
      user: HUMAN,
      number: 300,
      body: 'Closes #201',
      files: ['a'],
      issueBody: (n) => fetchIssue('o/r', n),
    });
    assert.equal(r.ok, false, r.lines.join('\n'));
    assert.match(r.lines[0], /#201 is a pull request/);
    assert.deepEqual(calls, ['/repos/o/r/issues/201']);
  } finally {
    globalThis.fetch = realFetch;
  }
});
