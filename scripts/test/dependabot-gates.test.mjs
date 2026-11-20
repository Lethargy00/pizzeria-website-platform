// #59: Dependabot PRs get a narrow path through touches-guard; review-gate is unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateTouches,
  isDependabot,
  isWebFlow,
  DEPENDABOT,
  WEB_FLOW,
} from '../touches-guard.mjs';
import { evaluate, changedPaths, prFilesAndLabels, prAuthorAndCommits } from '../review-gate.mjs';

const BOT = { login: 'dependabot[bot]', type: 'Bot', id: 49699333 };
const HUMAN = { login: 'Wetterbro', type: 'User', id: 47597724 };
const WEBFLOW = { login: 'web-flow', type: 'User', id: 19864447 };
const botCommit = { sha: 'a'.repeat(40), author: BOT, committer: WEBFLOW, verified: true };
const ISSUE = '## Touches\n- `scripts/**`\n';
const issueBody = (n) => (n === 59 ? ISSUE : '');
const DEP_BODY = 'Bumps vitest from 3.2.4 to 5.1.0.\n\n---\nDependabot commands and options';

const run = (pr) => evaluateTouches({ commits: [botCommit], body: DEP_BODY, issueBody, ...pr });

test('isDependabot: login, type and id must all match the API identity', () => {
  assert.equal(DEPENDABOT.login, 'dependabot[bot]');
  assert.ok(isDependabot(BOT));
  for (const u of [
    null,
    undefined,
    {},
    HUMAN,
    { ...BOT, type: 'User' },
    { ...BOT, id: 1 },
    { ...BOT, login: 'dependabot' },
    { ...BOT, login: 'Dependabot[bot]' },
    { login: 'dependabot-preview[bot]', type: 'Bot', id: 27856297 },
    { login: 'evil[bot]', type: 'Bot', id: 49699333 },
  ])
    assert.equal(isDependabot(u), false, JSON.stringify(u));
});

const cases = [
  // [name, pr, expected ok]
  [
    'dependabot: root lockfile + package.json',
    { user: BOT, files: ['package.json', 'pnpm-lock.yaml'] },
    true,
  ],
  [
    'dependabot: package and playground manifests',
    {
      user: BOT,
      files: ['packages/ui/package.json', 'playground/package.json', 'pnpm-lock.yaml'],
    },
    true,
  ],
  [
    'dependabot: github-actions bump in workflows',
    { user: BOT, files: ['.github/workflows/ci.yml', '.github/workflows/pr-gates.yml'] },
    true,
  ],
  [
    'dependabot: body with an unrelated Closes is ignored, allow-list still applies',
    { user: BOT, body: 'Closes #59', files: ['scripts/review-gate.mjs'] },
    false,
  ],
  [
    'dependabot: touches a script',
    { user: BOT, files: ['pnpm-lock.yaml', 'scripts/x.mjs'] },
    false,
  ],
  ['dependabot: touches tenant content', { user: BOT, files: ['tenants/a/site.yaml'] }, false],
  ['dependabot: nested manifest', { user: BOT, files: ['packages/ui/sub/package.json'] }, false],
  ['dependabot: .npmrc', { user: BOT, files: ['.npmrc'] }, false],
  ['dependabot: pnpm-workspace.yaml', { user: BOT, files: ['pnpm-workspace.yaml'] }, false],
  ['dependabot: dependabot.yml', { user: BOT, files: ['.github/dependabot.yml'] }, false],
  ['dependabot: CODEOWNERS', { user: BOT, files: ['.github/CODEOWNERS'] }, false],
  ['dependabot: no files', { user: BOT, files: [] }, false],
  [
    'dependabot: a human pushed a commit to the branch',
    {
      user: BOT,
      files: ['pnpm-lock.yaml'],
      commits: [botCommit, { sha: 'b'.repeat(40), author: HUMAN, verified: true }],
    },
    false,
  ],
  [
    'dependabot: commit with spoofed dependabot author but no valid signature',
    { user: BOT, files: ['pnpm-lock.yaml'], commits: [{ ...botCommit, verified: false }] },
    false,
  ],
  [
    'dependabot: bot author, human committer signing with own key (verified)',
    {
      user: BOT,
      files: ['pnpm-lock.yaml'],
      commits: [{ ...botCommit, committer: HUMAN, verified: true }],
    },
    false,
  ],
  [
    'dependabot: committer named web-flow with the wrong id',
    {
      user: BOT,
      files: ['pnpm-lock.yaml'],
      commits: [{ ...botCommit, committer: { ...WEBFLOW, id: 1 } }],
    },
    false,
  ],
  [
    'dependabot: commit without a linked committer',
    { user: BOT, files: ['pnpm-lock.yaml'], commits: [{ ...botCommit, committer: null }] },
    false,
  ],
  [
    'dependabot: rename from a script into an allowed path (both paths listed)',
    {
      user: BOT,
      files: changedPaths([{ filename: 'package.json', previous_filename: 'scripts/x.mjs' }]),
    },
    false,
  ],
  [
    'dependabot: rename between allowed paths',
    {
      user: BOT,
      files: changedPaths([
        { filename: 'packages/ui/package.json', previous_filename: 'packages/old/package.json' },
      ]),
    },
    true,
  ],
  [
    'dependabot: commit without a linked GitHub author',
    { user: BOT, files: ['pnpm-lock.yaml'], commits: [{ ...botCommit, author: null }] },
    false,
  ],
  ['dependabot: no commits', { user: BOT, files: ['pnpm-lock.yaml'], commits: [] }, false],
  // Non-Dependabot authors: unchanged behaviour.
  ['human without Closes #n', { user: HUMAN, files: ['pnpm-lock.yaml'] }, false],
  [
    'human with a Dependabot-looking body and labels',
    { user: HUMAN, body: `${DEP_BODY}\nlabels: type:dependency`, files: ['package.json'] },
    false,
  ],
  [
    'bot spoof: login "dependabot[bot]" but type User',
    { user: { ...BOT, type: 'User' }, files: ['pnpm-lock.yaml'] },
    false,
  ],
  [
    'other bot (github-actions[bot]) without Closes',
    { user: { login: 'github-actions[bot]', type: 'Bot', id: 41898282 }, files: ['package.json'] },
    false,
  ],
  [
    'human with Closes #59 inside Touches',
    { user: HUMAN, body: 'Closes #59', files: ['scripts/a.mjs'] },
    true,
  ],
  [
    'human with Closes #59 outside Touches (manifest)',
    { user: HUMAN, body: 'Closes #59', files: ['scripts/a.mjs', 'package.json'] },
    false,
  ],
  [
    'human closing an issue without Touches',
    { user: HUMAN, body: 'Closes #60', files: ['scripts/a.mjs'] },
    false,
  ],
];

for (const [name, pr, ok] of cases) {
  test(`touches-guard: ${name} → ${ok ? 'pass' : 'fail'}`, async () => {
    const r = await run(pr);
    assert.equal(r.ok, ok, r.lines.join('\n'));
    assert.ok(r.lines.length > 0);
  });
}

test('isWebFlow: login and id must both match', () => {
  assert.equal(WEB_FLOW.id, 19864447);
  assert.ok(isWebFlow(WEBFLOW));
  for (const u of [null, {}, HUMAN, { ...WEBFLOW, id: 2 }, { ...WEBFLOW, login: 'web_flow' }, BOT])
    assert.equal(isWebFlow(u), false, JSON.stringify(u));
});

test('changedPaths: renames contribute both old and new path', () => {
  assert.deepEqual(
    changedPaths([
      { filename: 'a.json' },
      { filename: 'package.json', previous_filename: 'scripts/x.mjs' },
      { filename: 'b', previous_filename: 'b' },
    ]),
    ['a.json', 'package.json', 'scripts/x.mjs', 'b'],
  );
});

// Identity comes only from the pulls API `user` / commit `author`+`committer` fields: a body,
// labels or commit metadata (git author name/email) that claim Dependabot change nothing.
test('API wiring: identity from pulls API fields only; renames expose the source path', async () => {
  const SPOOF_BODY =
    'Bumps x. Signed-off-by: dependabot[bot] <49699333+dependabot[bot]@users.noreply.github.com>';
  const routes = {
    'pulls/1/files': [{ filename: 'package.json', previous_filename: 'scripts/x.mjs' }],
    'issues/1': {
      body: SPOOF_BODY,
      labels: [{ name: 'type:dependency' }, { name: 'review:security' }],
      user: BOT, // issues API user is NOT used for identity
    },
    'pulls/1/commits': [
      {
        sha: 'c'.repeat(40),
        author: HUMAN,
        committer: WEBFLOW,
        commit: {
          author: {
            name: 'dependabot[bot]',
            email: '49699333+dependabot[bot]@users.noreply.github.com',
          },
          verification: { verified: true, reason: 'valid' },
        },
      },
    ],
    'pulls/1': { user: HUMAN, body: SPOOF_BODY },
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname.replace(/^\/repos\/o\/r\//, '');
    if (!(path in routes)) return { ok: false, status: 404, json: async () => ({}) };
    const page = new URL(url).searchParams.get('page');
    return { ok: true, status: 200, json: async () => (page && page !== '1' ? [] : routes[path]) };
  };
  try {
    const { files, body, labels } = await prFilesAndLabels('o/r', 1);
    assert.deepEqual(files, ['package.json', 'scripts/x.mjs']);
    assert.ok(labels.includes('type:dependency'));
    const { user, commits } = await prAuthorAndCommits('o/r', 1);
    assert.deepEqual(user, { login: HUMAN.login, type: HUMAN.type, id: HUMAN.id });
    assert.deepEqual(commits[0].author, { login: HUMAN.login, type: HUMAN.type, id: HUMAN.id });
    assert.equal(commits[0].verified, true);
    const r = await evaluateTouches({ user, commits, files, body, issueBody });
    assert.equal(r.ok, false);
    assert.match(r.lines[0], /no "Closes #<issue>"/);
    // Same files from the real bot: the rename's source path still fails the allow-list.
    const asBot = await evaluateTouches({
      user: BOT,
      commits: [botCommit],
      files,
      body,
      issueBody,
    });
    assert.equal(asBot.ok, false);
    assert.ok(asBot.lines.some((l) => l.includes('scripts/x.mjs')));
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('verified requires reason "valid"', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => ({
    ok: true,
    status: 200,
    json: async () =>
      new URL(url).pathname.endsWith('/commits')
        ? [
            {
              sha: 'd'.repeat(40),
              author: BOT,
              committer: WEBFLOW,
              commit: { verification: { verified: true, reason: 'unknown_key' } },
            },
          ]
        : { user: BOT },
  });
  try {
    const { commits } = await prAuthorAndCommits('o/r', 1);
    assert.equal(commits[0].verified, false);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('touches-guard: Dependabot path never reads an issue', async () => {
  let reads = 0;
  const r = await run({
    user: BOT,
    files: ['pnpm-lock.yaml'],
    issueBody: () => {
      reads++;
      return ISSUE;
    },
  });
  assert.equal(r.ok, true);
  assert.equal(reads, 0);
});

// review-gate is author-agnostic: the matrix for Dependabot's files is the same as for anyone.
const reviewCases = [
  [['pnpm-lock.yaml'], ['approved:peer'], ['approved:architect', 'approved:security']],
  [
    ['package.json', 'pnpm-lock.yaml'],
    ['approved:peer', 'approved:security'],
    ['approved:architect'],
  ],
  [
    ['playground/package.json'],
    ['approved:peer', 'approved:architect'],
    ['approved:a11y-perf', 'approved:security'],
  ],
  [
    ['packages/ui/package.json'],
    ['approved:peer'],
    ['approved:a11y-perf', 'approved:architect', 'approved:security'],
  ],
  [['.github/workflows/ci.yml'], ['approved:peer'], ['approved:security']],
  [
    ['package.json', 'pnpm-lock.yaml'],
    ['type:dependency', 'review:architect', 'review:security'],
    ['approved:architect', 'approved:peer', 'approved:security'],
  ],
  [['pnpm-lock.yaml'], ['approved:peer', 'approved:architect', 'approved:security'], []],
];

for (const [files, labels, missing] of reviewCases) {
  test(`review-gate: ${files.join('+')} with [${labels.join(', ')}] → missing [${missing.join(', ')}]`, () => {
    assert.deepEqual(
      evaluate(files, labels)
        .missing.map((m) => m.label)
        .sort(),
      missing,
    );
  });
}
