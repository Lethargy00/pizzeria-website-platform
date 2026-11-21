// #131: touches-guard takes Touches only from a real issue, never from a pull request
// (the issues API also returns PRs, marked by a `pull_request` key).
// #150: and only from a trusted issue in this repository (agent:* label, author_association
// OWNER/MEMBER/COLLABORATOR, no redirects, matching repository_url and number).
// #148: fenced code blocks (``` and ~~~) never supply a Touches section or a Closes line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  closedIssue,
  evaluateTouches,
  fetchIssue,
  parseTouches,
  stripFences,
} from '../touches-guard.mjs';

const HUMAN = { login: 'Wetterbro', type: 'User', id: 47597724 };
const BOT = { login: 'dependabot[bot]', type: 'Bot', id: 49699333 };
const WEBFLOW = { login: 'web-flow', type: 'User', id: 19864447 };
const WIDE = 'Closes #200\n## Touches\n- `**`\n';
const PR_KEY = { url: 'https://api.github.com/repos/o/r/pulls/200' };
const REPO_URL = 'https://api.github.com/repos/o/r';
const TRUSTED = {
  repository_url: REPO_URL,
  author_association: 'COLLABORATOR',
  labels: [{ name: 'status:in-progress' }, { name: 'agent:platform-1' }],
};

// What the issues API returns: #50 is an issue, #200 and #201 are pull requests.
const api = {
  50: { number: 50, ...TRUSTED, body: '## Touches\n- `scripts/**`\n' },
  200: { number: 200, ...TRUSTED, body: WIDE, pull_request: PR_KEY },
  201: { number: 201, ...TRUSTED, body: '## Touches\n- `**`\n', pull_request: PR_KEY },
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
    issueBody: () => ({ ...api[50], body: null }),
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

// ---- #150: who wrote the issue, and which repository it lives in ----

const issue50 = (over) => () => ({ ...api[50], ...over });
const closes50 = (issueBody) =>
  run({ number: 300, body: 'Closes #50', files: ['scripts/a.mjs'], issueBody });

test('outsider-authored issue fails even with an agent:* label and broad Touches', async () => {
  for (const author_association of [
    'NONE',
    'CONTRIBUTOR',
    'FIRST_TIME_CONTRIBUTOR',
    'FIRST_TIMER',
    'MANNEQUIN',
    '',
    undefined,
    'owner',
  ]) {
    const r = await closes50(issue50({ author_association, body: '## Touches\n- `**`\n' }));
    assert.equal(r.ok, false, String(author_association));
    assert.match(r.lines.join('\n'), /association .*trusted only from OWNER, MEMBER, COLLABORATOR/);
  }
});

test('issue with no agent:* label fails', async () => {
  for (const labels of [
    [],
    undefined,
    null,
    [{ name: 'status:ready' }],
    [{ name: 'agent:' }],
    ['xagent:a'],
    [{ name: 'role:agent:x' }],
    [{}],
    'agent:x',
  ]) {
    const r = await closes50(issue50({ labels }));
    assert.equal(r.ok, false, JSON.stringify(labels));
    assert.match(r.lines[0], /has no agent:\* label/);
  }
});

test('both trust failures are reported together', async () => {
  const r = await closes50(issue50({ labels: [], author_association: 'NONE' }));
  assert.equal(r.ok, false);
  assert.equal(r.lines.length, 2);
});

test('trusted issue passes for OWNER, MEMBER and COLLABORATOR; labels may be strings', async () => {
  for (const author_association of ['OWNER', 'MEMBER', 'COLLABORATOR']) {
    const r = await closes50(issue50({ author_association, labels: ['agent:security-21'] }));
    assert.equal(r.ok, true, `${author_association}: ${r.lines.join('\n')}`);
  }
});

test('a bare string body (no labels, no author) is never trusted', async () => {
  const r = await closes50(() => '## Touches\n- `**`\n');
  assert.equal(r.ok, false);
  assert.match(r.lines.join('\n'), /no agent:\* label/);
});

test('trust is checked before Touches are parsed', async () => {
  const r = await closes50(issue50({ labels: [], body: '' }));
  assert.match(r.lines[0], /no agent:\* label/);
});

/** Run fetchIssue against a stubbed fetch that answers with `res`. */
async function withFetch(res, fn) {
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ path: new URL(url).pathname, opts });
    if (res instanceof Error) throw res;
    return {
      status: res.status,
      ok: res.status >= 200 && res.status < 300,
      json: async () => res.json,
    };
  };
  try {
    return { calls, out: await fn() };
  } finally {
    globalThis.fetch = realFetch;
  }
}

test('fetchIssue refuses redirects (transferred issues)', async () => {
  const { calls, out } = await withFetch({ status: 200, json: api[50] }, () =>
    fetchIssue('o/r', 50),
  );
  assert.equal(calls[0].opts.redirect, 'error');
  assert.equal(out.number, 50);
  // What Node's fetch does with redirect: 'error' on a 301.
  await assert.rejects(
    withFetch(new TypeError('fetch failed', { cause: new Error('unexpected redirect') }), () =>
      fetchIssue('o/r', 50),
    ),
    /redirected.*transferred issue/s,
  );
  // A 3xx that reaches us anyway (e.g. an opaque redirect) is refused too.
  await assert.rejects(
    withFetch({ status: 301, json: {} }, () => fetchIssue('o/r', 50)),
    /redirected \(HTTP 301\)/,
  );
});

test('fetchIssue refuses a foreign or missing repository_url and a different number', async () => {
  for (const repository_url of [
    'https://api.github.com/repos/other/repo',
    'https://api.github.com/repos/xo/r',
    'https://api.github.com/repos/o/r/extra',
    'https://evil.example/repos/o/r',
    undefined,
  ]) {
    await assert.rejects(
      withFetch({ status: 200, json: { ...api[50], repository_url } }, () => fetchIssue('o/r', 50)),
      /repository_url/,
      String(repository_url),
    );
  }
  const ok = await withFetch(
    { status: 200, json: { ...api[50], repository_url: 'https://api.github.com/repos/O/R' } },
    () => fetchIssue('o/r', 50),
  );
  assert.equal(ok.out.number, 50);
  await assert.rejects(
    withFetch({ status: 200, json: { ...api[50], number: 9 } }, () => fetchIssue('o/r', 50)),
    /returned #9 instead/,
  );
  await assert.rejects(
    withFetch({ status: 404, json: {} }, () => fetchIssue('o/r', 50)),
    /HTTP 404/,
  );
});

test('Dependabot needs no issue, so the trust checks do not apply to it', async () => {
  const r = await evaluateTouches({
    user: BOT,
    commits: [{ sha: 'b'.repeat(40), author: BOT, committer: WEBFLOW, verified: true }],
    files: ['package.json', '.github/workflows/ci.yml'],
    body: 'Bumps y.',
    issueBody: () => assert.fail('must not read an issue'),
  });
  assert.equal(r.ok, true, r.lines.join('\n'));
});

// ---- #148: fenced code blocks never decide the result ----

const REAL = '## Touches\n- `scripts/**`\n';

test('fences: backtick and tilde, any length of 3 or more, up to 3 leading spaces', () => {
  for (const f of ['```', '````', '`````', '~~~', '~~~~', ' ```', '  ~~~', '   ```']) {
    assert.deepEqual(parseTouches(`${f}\n## Touches\n- \`**\`\n${f}\n`), [], f);
    assert.equal(closedIssue(`${f}\nCloses #5\n${f}\n`), null, f);
    assert.deepEqual(parseTouches(`${f}\n## Touches\n- \`**\`\n${f}\n${REAL}`), ['scripts/**'], f);
  }
});

test('a fenced Touches block above the real one is ignored (the #131 reproduction)', () => {
  const body = 'Example:\n```\n## Touches\n- `**`\n```\n\n' + REAL;
  assert.deepEqual(parseTouches(body), ['scripts/**']);
});

test('a fenced heading neither starts nor ends the real Touches section', () => {
  const body = '## Touches\n- `a/**`\n```\n## Other\n- `b/**`\n```\n- `c/**`\n## Next\n- `d`\n';
  assert.deepEqual(parseTouches(body), ['a/**', 'c/**']);
});

test('fail closed: a Touches heading only inside a fence means no Touches section', async () => {
  const fenced = '```\n## Touches\n- `**`\n```\n';
  assert.deepEqual(parseTouches(fenced), []);
  const r = await closes50(issue50({ body: fenced }));
  assert.equal(r.ok, false);
  assert.match(r.lines[0], /no Touches globs/);
});

test('an unclosed fence runs to the end of the body (fail closed)', async () => {
  assert.deepEqual(parseTouches('```\n' + REAL), []);
  assert.deepEqual(parseTouches('~~~~\n' + REAL), []);
  assert.equal(closedIssue('text\n```\nCloses #50\n'), null);
  // Touches before an unclosed fence still count; those after it do not.
  assert.deepEqual(parseTouches(REAL + '```\n## Touches\n- `**`\n'), ['scripts/**']);
  const r = await closes50(issue50({ body: '```\n' + REAL }));
  assert.equal(r.ok, false);
  assert.match(r.lines[0], /no Touches globs/);
});

test('closing fence rules: same character, at least as long, nothing else on the line', () => {
  const body = (close) => `\`\`\`\`\n${close}\nCloses #7\n`;
  // Too short, wrong character, or trailing text: the fence stays open.
  for (const close of ['```', '~~~~', '```` x', '````x']) {
    assert.equal(closedIssue(body(close)), null, close);
  }
  // Same or longer run, optional trailing spaces and up to 3 leading spaces: closed.
  for (const close of ['````', '`````', '````  ', '   ````']) {
    assert.equal(closedIssue(body(close)), 7, close);
  }
  // A tilde fence is not closed by backticks, and vice versa.
  assert.equal(closedIssue('~~~\n```\nCloses #7\n'), null);
  assert.equal(closedIssue('```\n~~~\nCloses #7\n'), null);
});

test('a longer fence can contain a shorter one', () => {
  const body = '````\n```\nCloses #5\n```\n````\nCloses #6\n';
  assert.equal(closedIssue(body), 6);
});

test('not fences: 4+ leading spaces, fewer than 3 marks, or a backtick in a backtick info string', () => {
  assert.equal(closedIssue('    ```\nCloses #5\n'), 5);
  assert.equal(closedIssue('``\nCloses #5\n'), 5);
  assert.equal(closedIssue('~~\nCloses #5\n'), 5);
  assert.equal(closedIssue('```js`x`\nCloses #5\n'), 5);
  // An info string is fine on a backtick or tilde fence.
  assert.equal(closedIssue('```js\nCloses #5\n```\n'), null);
  assert.equal(closedIssue('~~~ a`b\nCloses #5\n~~~\n'), null);
});

test('CRLF and CR line endings are handled', () => {
  const crlf = '```\r\n## Touches\r\n- `**`\r\n```\r\n## Touches\r\n- `x`\r\n';
  assert.deepEqual(parseTouches(crlf), ['x']);
  assert.equal(closedIssue('```\rCloses #5\r```\rCloses #6'), 6);
});

test('a fenced Closes line is ignored; a real one wins wherever it sits', () => {
  assert.equal(closedIssue('```\nCloses #5\n```\nCloses #6'), 6);
  assert.equal(closedIssue('Closes #6\n```\nCloses #5\n```'), 6);
  assert.equal(closedIssue('```\nCloses #5\n```'), null);
  assert.equal(closedIssue(null), null);
  assert.deepEqual(parseTouches(undefined), []);
});

test('evaluateTouches: a fenced-only Closes fails; fenced wide Touches cannot widen', async () => {
  const noClose = await run({
    number: 300,
    body: '```\nCloses #50\n```',
    files: ['scripts/a.mjs'],
  });
  assert.equal(noClose.ok, false);
  assert.match(noClose.lines[0], /no "Closes #<issue>"/);
  const fencedWide = issue50({ body: '```\n## Touches\n- `**`\n```\n' + REAL });
  const ok = await closes50(fencedWide);
  assert.equal(ok.ok, true, ok.lines.join('\n'));
  const out = await run({
    number: 300,
    body: 'Closes #50',
    files: ['package.json'],
    issueBody: fencedWide,
  });
  assert.equal(out.ok, false);
  assert.match(out.lines[0], /outside the Touches of #50 \(scripts\/\*\*\)/);
});

test('a fenced Closes cannot redirect the check to another issue', async () => {
  const r = await run({
    number: 300,
    body: '```\nCloses #201\n```\nCloses #50',
    files: ['package.json'],
  });
  assert.equal(r.ok, false);
  assert.match(r.lines[0], /outside the Touches of #50/);
});

test('stripFences keeps the line count and non-fence text', () => {
  assert.equal(stripFences('a\n```\nb\n```\nc'), 'a\n\n\n\nc');
  assert.equal(stripFences(undefined), '');
});
