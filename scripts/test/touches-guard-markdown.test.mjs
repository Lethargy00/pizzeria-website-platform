// #191: touches-guard reads Touches globs only from Markdown list items, never lets an inline
// code span cross a line break, and reads "Closes #n" only from plain lines (never from an
// indented code block or a blockquote), in line with the fenced-block rule from #148.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closedIssue, evaluateTouches, parseTouches, plainLines } from '../touches-guard.mjs';

const HUMAN = { login: 'Wetterbro', type: 'User', id: 47597724 };
const issue = (body) => ({
  number: 50,
  repository_url: 'https://api.github.com/repos/o/r',
  author_association: 'COLLABORATOR',
  labels: [{ name: 'agent:platform-1' }],
  body,
});

// ---- Touches: list items only ----

test('globs come from -, *, + and numbered list items', () => {
  const body = '## Touches\n- `a/**`\n* `b/**`\n+ `c/**`\n1. `d/**`\n2) `e/**`\n10. `f`\n';
  assert.deepEqual(parseTouches(body), ['a/**', 'b/**', 'c/**', 'd/**', 'e/**', 'f']);
});

test('several code spans on one list item all count; text around them is fine', () => {
  const body = '## Touches\n- `a/**`, `b.md` (docs) and `c/*.ts`\n';
  assert.deepEqual(parseTouches(body), ['a/**', 'b.md', 'c/*.ts']);
});

test('list items may have up to 3 leading spaces, and tabs after the marker', () => {
  assert.deepEqual(parseTouches('## Touches\n   - `a`\n-\t`b`\n'), ['a', 'b']);
});

test('prose lines under Touches are ignored (the #191 reproduction)', () => {
  const body = "## Touches\n- `scripts/**`\n```\n## Notes\n```\nDon't touch `**`.\n`x/**`\n";
  assert.deepEqual(parseTouches(body), ['scripts/**']);
});

test('prose-only Touches (as on #101) gives no globs and fails closed', async () => {
  const body = '## Touches\nTo be decided. Likely `packages/a/**` or `packages/b/**`.\n';
  assert.deepEqual(parseTouches(body), []);
  const r = await evaluateTouches({
    user: HUMAN,
    number: 300,
    body: 'Closes #50',
    files: ['packages/a/x.ts'],
    issueBody: () => issue(body),
  });
  assert.equal(r.ok, false);
  assert.match(r.lines[0], /no Touches globs/);
});

test('not list items: no space after the marker, bold, 4+ spaces, quotes, continuations', () => {
  for (const line of [
    '-`a`',
    '**`a`**',
    '1.`a`',
    '    - `a`',
    '\t- `a`',
    '> - `a`',
    '>- `a`',
    '- [`a`](x)  \n  `b`', // the continuation line `b` is prose, `a` stays
  ]) {
    const got = parseTouches(`## Touches\n${line}\n`);
    assert.deepEqual(got, line.startsWith('- [') ? ['a'] : [], line);
  }
});

test('a list item outside the Touches section does not count', () => {
  const body = '## Scope\n- `x/**`\n## Touches\n- `a`\n## Contracts\n- `y/**`\n';
  assert.deepEqual(parseTouches(body), ['a']);
});

test('the issue-form layout (### Touches, blank lines) still works with list items', () => {
  const form = '### Scope\n\nIn\n\n### Touches\n\n- `packages/core/**`\n\n### Contracts\n\n_None_';
  assert.deepEqual(parseTouches(form), ['packages/core/**']);
});

// ---- inline code never crosses a line break ----

test('an unclosed code span does not pair with a backtick on the next line', () => {
  const body = '## Touches\n- `a/**\n- b/**`\n- `c`\n';
  assert.deepEqual(parseTouches(body), ['c']);
});

test('CRLF bodies split into lines too', () => {
  assert.deepEqual(parseTouches('## Touches\r\n- `a\r\n- b`\r\n- `c`\r\n'), ['c']);
});

test('an empty or blank code span gives nothing', () => {
  assert.deepEqual(parseTouches('## Touches\n- `` ``\n- ` `\n- `a`\n'), ['a']);
});

// ---- Closes only from plain lines ----

test('Closes in a 4-space or tab-indented code block is ignored', () => {
  assert.equal(closedIssue('Example:\n\n    Closes #5\n'), null);
  assert.equal(closedIssue('\tCloses #5\n'), null);
  assert.equal(closedIssue('  \tCloses #5\n'), null); // 2 spaces + tab = 4 columns
  assert.equal(closedIssue('    Closes #5\n\nCloses #6\n'), 6);
});

test('up to 3 leading spaces is still a plain line', () => {
  assert.equal(closedIssue('   Closes #5\n'), 5);
  assert.equal(closedIssue('- Closes #5\n'), 5);
});

test('Closes in a blockquote is ignored, including nested and lazy continuation lines', () => {
  assert.equal(closedIssue('> Closes #5\n'), null);
  assert.equal(closedIssue('   > Closes #5\n'), null);
  assert.equal(closedIssue('>> Closes #5\n'), null);
  assert.equal(closedIssue('>Closes #5\n'), null);
  assert.equal(closedIssue('> quoted text\nCloses #5\n'), null); // lazy continuation
  assert.equal(closedIssue('> quoted\n\nCloses #6\n'), 6); // a blank line ends the quote
});

test('a quoted or indented Closes cannot redirect the check to another issue', async () => {
  for (const body of ['> Closes #201\n\nCloses #50', '    Closes #201\n\nCloses #50']) {
    let asked = null;
    const r = await evaluateTouches({
      user: HUMAN,
      number: 300,
      body,
      files: ['package.json'],
      issueBody: (n) => {
        asked = n;
        return issue('## Touches\n- `scripts/**`\n');
      },
    });
    assert.equal(asked, 50, body);
    assert.equal(r.ok, false);
    assert.match(r.lines[0], /outside the Touches of #50/);
  }
});

test('only quoted or indented Closes lines means no Closes at all (fail closed)', async () => {
  const r = await evaluateTouches({
    user: HUMAN,
    number: 300,
    body: '> Closes #50\n\n    Fixes #50\n',
    files: ['scripts/a.mjs'],
    issueBody: () => issue('## Touches\n- `scripts/**`\n'),
  });
  assert.equal(r.ok, false);
  assert.match(r.lines[0], /no "Closes #<issue>"/);
});

test('fenced Closes lines are still ignored (#148) and line counts are kept', () => {
  assert.equal(closedIssue('```\nCloses #5\n```\nCloses #6'), 6);
  assert.equal(plainLines('a\n> b\nc\n\n    d\ne'), 'a\n\n\n\n\ne');
  assert.equal(plainLines(undefined), '');
});
