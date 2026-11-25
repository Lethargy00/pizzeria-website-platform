// #208: touches-guard collects every closing reference GitHub could link and fails closed unless
// they all name one plain "#n"; Closes inside inline code or an HTML comment is ignored; a
// heading at any level ends Touches and Touches list items inside comments or HTML blocks are
// ignored; blockquote lazy continuation and indented code follow CommonMark.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  closedIssue,
  closingRefs,
  evaluateTouches,
  parseTouches,
  plainLines,
} from '../touches-guard.mjs';

const HUMAN = { login: 'Wetterbro', type: 'User', id: 47597724 };
const issue = (n, body) => ({
  number: n,
  repository_url: 'https://api.github.com/repos/o/r',
  author_association: 'COLLABORATOR',
  labels: [{ name: 'agent:platform-1' }],
  body,
});
const issues = { 50: '## Touches\n- `scripts/**`\n', 51: '## Touches\n- `**`\n' };
const run = (body, files = ['scripts/a.mjs'], seen = []) =>
  evaluateTouches({
    user: HUMAN,
    number: 300,
    body,
    files,
    issueBody: (n) => {
      seen.push(n);
      return issue(n, issues[n] ?? '');
    },
  });
const nums = (body) => closingRefs(body).map((r) => r.issue);

// ---- more than one closing reference ----

test('every closing reference is collected, on separate lines or the same line', () => {
  assert.deepEqual(nums('Closes #50\nFixes #51\n'), [50, 51]);
  assert.deepEqual(nums('Closes #50, closes #51 and resolves #52'), [50, 51, 52]);
  assert.equal(closedIssue('Closes #50\nFixes #51\n'), null);
});

test('a reference without its own keyword is not closed by GitHub, so it does not count', () => {
  assert.deepEqual(nums('Closes #50, #51'), [50]);
  assert.equal(closedIssue('Closes #50, #51'), 50);
});

test('the same issue named twice is one issue', () => {
  assert.equal(closedIssue('Closes #50\n\nFixes #50'), 50);
});

test('every keyword form, in any case', () => {
  for (const k of ['close', 'closes', 'closed', 'fix', 'fixes', 'fixed', 'resolve', 'resolves']) {
    for (const kw of [k, k.toUpperCase(), k[0].toUpperCase() + k.slice(1)]) {
      assert.deepEqual(nums(`${kw} #7`), [7], kw);
    }
  }
  assert.deepEqual(nums('Resolved #7'), [7]);
});

test('separators and spellings GitHub may link are read widely (fail closed)', () => {
  for (const s of [
    'Closes: #51',
    'Closes:#51',
    '**Closes** #51',
    '_Fixes #51_',
    '~~Fixes~~ #51',
    'Closes\n#51',
    'Closes \\#51',
    'Closes&#32;#51',
    'Closes &#35;51',
    'Closes &num;51',
    'Closes #&#53;1',
    'Clo&#115;es #51',
    'Closes&nbsp;#51',
    'Closes\u00a0#51',
    'Closes\u200b#51',
    'Closes [#51](https://x)',
  ]) {
    assert.deepEqual(nums(`Closes #50\n\n${s}`), [50, 51], JSON.stringify(s));
  }
});

test('not closing references', () => {
  for (const s of [
    'relates to #51',
    'prefixes #51',
    'unresolved #51',
    'fixes the bug in #51',
    'Closes #<n>',
    'closes issue 51',
  ]) {
    assert.deepEqual(nums(s), [], s);
  }
});

test('cross-repository, URL and GH- references are kept, but have no local issue number', () => {
  for (const s of [
    'Closes o/r#5',
    'Fixes https://github.com/o/r/issues/5',
    'Resolves GH-5',
    'Closes <https://github.com/o/r/issues/5>',
  ]) {
    const refs = closingRefs(s);
    assert.equal(refs.length, 1, s);
    assert.equal(refs[0].issue, null, s);
    assert.equal(closedIssue(s), null, s);
  }
});

test('evaluateTouches fails on two issues before reading either', async () => {
  const seen = [];
  const r = await run('Closes #50\nCloses #51\n', ['scripts/a.mjs'], seen);
  assert.equal(r.ok, false);
  assert.match(r.lines[0], /closes 2 issues \(#50, #51\)/);
  assert.deepEqual(seen, []);
});

test('a second issue cannot ride along with a narrow one (the #208 reproduction)', async () => {
  const r = await run('Closes #50\n\nAlso fixes #51.', ['package.json']);
  assert.equal(r.ok, false);
  assert.match(r.lines[0], /closes 2 issues/);
});

test('evaluateTouches fails on a reference that is not a plain #n', async () => {
  for (const body of ['Closes #50\nCloses o/r#51', 'Fixes https://github.com/o/r/issues/50']) {
    const seen = [];
    const r = await run(body, ['scripts/a.mjs'], seen);
    assert.equal(r.ok, false, body);
    assert.match(r.lines[0], /not a plain "#<issue>" reference/);
    assert.deepEqual(seen, []);
  }
});

test('one issue, named once or twice, still passes', async () => {
  for (const body of ['Closes #50', 'Closes #50\nFixes #50']) {
    const r = await run(body);
    assert.equal(r.ok, true, r.lines.join('\n'));
  }
});

// ---- inline code ----

test('Closes in an inline code span is ignored', () => {
  assert.equal(closedIssue('`Closes #51`\nCloses #50'), 50);
  assert.equal(closedIssue('Closes #50; never write ``Closes #51`` here.'), 50);
  assert.deepEqual(nums('Do not write `Fixes #51`.'), []);
  assert.deepEqual(nums('Closes `#51`'), []);
});

test('an escaped backtick does not open a span', () => {
  assert.deepEqual(nums('\\`Closes #51\\`\nCloses #50'), [51, 50]);
});

test('an unmatched backtick in the paragraph puts its spans in doubt (fail closed)', () => {
  // GitHub pairs the first backtick with the one on the next line, so "Closes #51" is text.
  assert.deepEqual(nums('a `b\n`Closes #51` c\nCloses #50'), [51, 50]);
  // A blank line ends the paragraph, and with it the doubt.
  assert.deepEqual(nums('a `b\n\n`Closes #51`\nCloses #50'), [50]);
});

test('raw HTML in the paragraph puts its spans in doubt (fail closed)', () => {
  assert.deepEqual(nums('see <a title="`">Closes #51</a> `x`\nCloses #50'), [51, 50]);
  assert.deepEqual(nums('<https://x.test/`> Closes #51 `y`\n\nCloses #50'), [51, 50]);
});

test('a pipe inside a span puts it in doubt: a GFM table splits cells first', () => {
  assert.deepEqual(nums('| `a | Closes #51 | b` |\n\nCloses #50'), [51, 50]);
});

test('backticks inside an HTML block are literal, so they hide nothing', () => {
  assert.deepEqual(nums('<div>\n`Closes #51`\n</div>\n\nCloses #50'), [51, 50]);
});

// ---- HTML comments ----

test('Closes inside an HTML comment is ignored (one line, many lines, mid-line)', () => {
  assert.equal(closedIssue('<!-- Closes #51 -->\nCloses #50'), 50);
  assert.equal(closedIssue('<!--\nTemplate: Closes #51\n-->\nCloses #50'), 50);
  assert.equal(closedIssue('   <!-- a\nCloses #51 --> \nCloses #50'), 50);
  assert.equal(closedIssue('Closes #50 <!-- Closes #51 -->'), 50);
  // After a list item the body is read raw (latch), so the comment no longer hides #51.
  assert.equal(closedIssue('- note <!-- Closes #51 -->\n\nCloses #50'), null);
});

test('text after the end of a comment block is shown', () => {
  assert.deepEqual(nums('<!-- x --> Closes #51\nCloses #50'), [51, 50]);
});

test('an HTML comment ends at the earliest point any parser would end it', () => {
  // HTML parsers end a comment at "--!>" and at "<!-->" / "<!--->", even though CommonMark
  // keeps the HTML block open until a line with "-->".
  assert.deepEqual(nums('<!--\nx --!> Closes #51\n-->\nCloses #50'), [51, 50]);
  assert.deepEqual(nums('<!--> Closes #51\n\nCloses #50'), [51, 50]);
  assert.deepEqual(nums('<!---> Closes #51\n\nCloses #50'), [51, 50]);
});

test('an inline comment that is not valid in every CommonMark version is text', () => {
  for (const c of ['<!-- -- Closes #51 -->', '<!--> Closes #51 -->', '<!-- Closes #51 --->']) {
    assert.deepEqual(nums(`Closes #50 ${c}`), [50, 51], c);
  }
});

test('an unclosed comment block runs to the end of the body', () => {
  assert.equal(closedIssue('Closes #50\n<!--\nCloses #51\n'), 50);
});

test('comments and code cannot hide each other', () => {
  // "<!--" inside a code span or a fence is not a comment.
  assert.deepEqual(nums('`<!--` Closes #51 `-->`\n\nCloses #50'), [51, 50]);
  assert.deepEqual(nums('```\n<!--\n```\nCloses #51\n-->\n\nCloses #50'), [51, 50]);
  // A fence inside a comment is not a fence.
  assert.equal(closedIssue('<!--\n```\n-->\nCloses #50\n'), 50);
  // An indented "<!--" is code, not a comment.
  assert.deepEqual(nums('x\n\n    <!--\nCloses #51\n-->\n\nCloses #50'), [51, 50]);
});

test('a comment-only Closes means no Closes at all', async () => {
  const r = await run('<!-- Closes #50 -->\n');
  assert.equal(r.ok, false);
  assert.match(r.lines[0], /no "Closes #<issue>"/);
});

// ---- blockquotes: CommonMark lazy continuation ----

test('only a paragraph continues a quote lazily', () => {
  assert.deepEqual(nums('> quote\nCloses #51'), []);
  assert.deepEqual(nums('> quote\n    Closes #51'), []); // indented paragraph continuation
  // A list item inside the quote latches raw reading: over-counted, which fails closed.
  assert.deepEqual(nums('> - item\nCloses #51'), [51]);
});

test('a line that could interrupt a paragraph ends the quote', () => {
  for (const line of [
    '- Closes #51',
    '* Closes #51',
    '1. Closes #51',
    '# Closes #51',
    '#### Closes #51',
    '<!-- x -->\nCloses #51',
    '<div>Closes #51</div>',
    '---\nCloses #51',
    '***\nCloses #51',
    '===\nCloses #51',
    '```\nx\n```\nCloses #51',
  ]) {
    assert.deepEqual(nums(`> quote\n${line}`), [51], line);
  }
});

test('a quote with no open paragraph has no lazy lines', () => {
  for (const q of [
    '>',
    '> ',
    '> # heading',
    '> ---',
    '> ```',
    '> ```\n> code',
    '> <div>\n> x',
    '>     code',
    '> - ',
  ]) {
    assert.deepEqual(nums(`${q}\nCloses #51`), [51], q);
  }
});

test('a blank line ends the quote; quoted Closes stays ignored', () => {
  assert.deepEqual(nums('> Closes #51\n\nCloses #50'), [50]);
  assert.deepEqual(nums('> a\n>\n> Closes #51\n\nCloses #50'), [50]);
});

// ---- indented lines ----

test('an indented line that continues a paragraph is text, as GitHub shows it', () => {
  assert.deepEqual(nums('intro\n    Closes #51'), [51]);
  assert.deepEqual(nums('Closes #50\n    Closes #51'), [50, 51]);
});

test('an indented line inside a list item is text, even after a blank line', () => {
  assert.deepEqual(nums('- item\n\n    Closes #51'), [51]);
  assert.deepEqual(nums('1. item\n\n    more\n\n    Closes #51'), [51]);
});

test('indented code after a blank line (or at the start) is still ignored', () => {
  assert.deepEqual(nums('    Closes #51'), []);
  assert.deepEqual(nums('intro\n\n    Closes #51\n\n    Fixes #52'), []);
  assert.equal(plainLines('a\n    b\n\n    c'), 'a\n    b\n\n');
});

// ---- a realistic PR body ----

test('a PR body from the template with comments and examples passes', async () => {
  const body = [
    '<!-- claude-projects-attribution: {"github_login":"x"} -->',
    '_Requested by **someone**_',
    '',
    '**[agent: platform-1 · role: platform]**',
    '',
    'Closes #50',
    '',
    '## Summary',
    '',
    'Ignores `Closes #51` in inline code and fixes the parser.',
    '',
    '> Earlier draft: Fixes #52',
    '',
    '```',
    'Closes #53',
    '```',
    '<!-- reviewers: Resolves #54 -->',
  ].join('\n');
  assert.deepEqual(nums(body), [50]);
  const r = await run(body);
  assert.equal(r.ok, true, r.lines.join('\n'));
});

// ---- Touches ----

const T = (rest) => parseTouches(`## Touches\n- \`a\`\n${rest}`);

test('a heading at any level ends the Touches section', () => {
  for (const h of ['# Next', '## Next', '### Next', '#### Notes', '##### x', '###### x', '#']) {
    assert.deepEqual(T(`${h}\n- \`**\`\n`), ['a'], h);
  }
});

test('a setext underline or thematic break ends the Touches section', () => {
  for (const h of ['Notes\n-----', 'Notes\n=====', '---', '***', '___', '- - -']) {
    assert.deepEqual(T(`${h}\n- \`**\`\n`), ['a'], h);
  }
});

test('an HTML heading ends the Touches section', () => {
  assert.deepEqual(T('<h4>Contracts</h4>\n\n- `**`\n'), ['a']);
});

test('a Touches list item inside an HTML comment is ignored', () => {
  assert.deepEqual(T('<!-- - `**` -->\n- `b`\n'), ['a', 'b']);
  assert.deepEqual(T('<!--\n- `**`\n-->\n- `b`\n'), ['a', 'b']);
  assert.deepEqual(T('- `b` <!-- `**` -->\n'), ['a', 'b']);
  // An item that starts with a comment is an HTML block in the item: nothing after it counts.
  assert.deepEqual(T('- <!-- `**` --> `b`\n'), ['a']);
  assert.deepEqual(T('- `b` <!--\n- `**`\n--> text\n- `c`\n'), ['a', 'b', 'c']);
});

test('Touches: an unclosed or short comment hides to the end (fail closed)', () => {
  assert.deepEqual(T('<!--\n- `**`\n'), ['a']);
  assert.deepEqual(T('- `b` <!-- x\n- `**`\n'), ['a', 'b']);
  // "<!-->" may not end the comment for every parser, so it hides until the next "-->".
  assert.deepEqual(T('<!-->\n- `**`\n-->\n- `b`\n'), ['a', 'b']);
});

test('a Touches heading inside a comment is not the Touches section', () => {
  assert.deepEqual(parseTouches('<!--\n## Touches\n- `**`\n-->\n## Touches\n- `a`\n'), ['a']);
  assert.deepEqual(parseTouches('<!--\n## Touches\n- `**`\n'), []);
});

test('list items inside an HTML block are raw HTML, not Touches', () => {
  assert.deepEqual(T('<div>\n- `**`\n</div>\n\n- `b`\n'), ['a', 'b']);
  assert.deepEqual(T('<details>\n<summary>x</summary>\n- `**`\n\n- `b`\n'), ['a', 'b']);
  assert.deepEqual(T('<pre>\n\n- `**`\n\n</pre>\n- `b`\n'), ['a', 'b']);
});

test('list items inside a fence that opens in a list item are ignored', () => {
  assert.deepEqual(T('- ```\n  - `**`\n  ```\n- `b`\n'), ['a', 'b']);
});

test('a list item holding a quote or indented code gives no glob', () => {
  assert.deepEqual(T('- > `**`\n-     `**`\n- `b`\n'), ['a', 'b']);
  assert.deepEqual(T('-\t`b`\n'), ['a', 'b']);
});

test('Touches: a quote hides every line up to the next blank line', () => {
  assert.deepEqual(T('> note\n2. `**`\n- `**`\n\n- `b`\n'), ['a', 'b']);
});

test('evaluateTouches: commented-out wide Touches cannot widen the issue', async () => {
  issues[60] = '## Touches\n- `scripts/**`\n<!--\n- `**`\n-->\n#### Notes\n- `**`\n';
  try {
    const ok = await run('Closes #60', ['scripts/a.mjs']);
    assert.equal(ok.ok, true, ok.lines.join('\n'));
    const bad = await run('Closes #60', ['package.json']);
    assert.equal(bad.ok, false);
    assert.match(bad.lines[0], /outside the Touches of #60 \(scripts\/\*\*\)/);
  } finally {
    delete issues[60];
  }
});

// ---- review fixes (qa-64 on PR #230) ----

test('a fence inside a list item ends with the item, so a later Closes is seen', () => {
  assert.deepEqual(nums('Closes #1\n\n- item\n  ```\nCloses #2\n```'), [1, 2]);
  assert.deepEqual(nums('Closes #1\n\n1. item\n   ```\nCloses #2\n```'), [1, 2]);
  assert.equal(closedIssue('Closes #1\n\n- item\n  ```\nCloses #2\n```'), null);
  // After the latch nothing hides, even text GitHub keeps in the item's fence (over-count).
  assert.deepEqual(nums('Closes #1\n\n- item\n  ```\n  Closes #2\n\n  Fixes #3\n  ```'), [1, 2, 3]);
  // A fence at the left margin after a list is read raw too.
  assert.deepEqual(nums('Closes #1\n\n- item\n\n```\nCloses #2\n```'), [1, 2]);
});

test('a comment block after a list item hides nothing either', () => {
  assert.deepEqual(nums('Closes #1\n\n- item\n  <!--\nCloses #2\n-->'), [1, 2]);
  assert.deepEqual(nums('Closes #1\n\n- item\n  <!--\n  Closes #2\n  -->'), [1, 2]);
});

test('Touches: a fence inside a list item keeps hiding (fewer globs)', () => {
  assert.deepEqual(T('- item\n  ```\n- `**`\n  ```\n- `b`\n'), ['a', 'b']);
});

test('only spaces and tabs make a blank line (NBSP, VT, FF and em space are text)', () => {
  for (const ws of ['\u00a0', '\u000b', '\u000c', '\u2003']) {
    const name = JSON.stringify(ws);
    // Paragraph continuation: the 4-space line is text, not indented code.
    assert.deepEqual(nums(`Closes #1\npara\n${ws}\n    Closes #2`), [1, 2], name);
    // Still one HTML block: its text is raw HTML, which is shown.
    assert.deepEqual(nums(`<div>\n${ws}\n\`\`\`\nCloses #2\n\`\`\`\n</div>`), [2], name);
    assert.deepEqual(nums(`<div>\n${ws}\n> Closes #2\n</div>`), [2], name);
    // Touches: the item is raw HTML inside the block, not a list item.
    assert.deepEqual(
      parseTouches(`## Touches\n- \`a\`\n<div>\n${ws}\n- \`**\`\n</div>`),
      ['a'],
      name,
    );
    // Nor does such a line end a quote: it is a lazy continuation line.
    assert.deepEqual(nums(`> quote\n${ws}\nCloses #2`), [], name);
  }
  // Real blank lines (spaces, tabs) still separate blocks.
  assert.deepEqual(nums('Closes #1\npara\n \t\n    Closes #2'), [1]);
});
