// #208, security-46's escalation decision on PR #230: in closes mode the scanner latches on the
// first line that could open a list item (also inside a quote) or a GFM footnote definition, or
// that opens a fence, comment or HTML block of types 1-5 inside an HTML block ending at a blank
// line. From that line on, the body is read raw (only character references are decoded), so a
// construct the scanner cannot measure can never hide a closing reference. Touches mode is
// unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closedIssue, closingRefs, evaluateTouches } from '../touches-guard.mjs';

const nums = (body) => closingRefs(body).map((r) => r.issue);
const F = '```';
const F4 = '````';

// [id, body, expected issues]. "cm" notes say how commonmark.js 0.31.2 reads #2.
const PROBES = [
  // qa-64 round 1
  ['R1-1', `Closes #1\n\n- item\n  ${F}\nCloses #2\n${F}\n`, [1, 2]],
  ['R1-2', `Closes #1\n\n1. item\n   ${F}\nCloses #2\n`, [1, 2]],
  ['R1-3', 'Closes #1\npara\n\u00a0\n    Closes #2\n', [1, 2]],
  ['R1-4', 'Closes #1\npara\n\u000b\n    Closes #2\n', [1, 2]],
  ['R1-5', `Closes #1\n\n<div>\n\u00a0\n${F}\nCloses #2\n${F}\n</div>\n`, [1, 2]],
  ['R1-6', 'Closes #1\n\n<div>\n\u00a0\n> Closes #2\n</div>\n', [1, 2]],
  ['R1-7', 'Closes #1\npara\n\f\n    Closes #2\n', [1, 2]],
  ['R1-8', 'Closes #1\n\n- item\n  <!--\nCloses #2\n-->\n', [1, 2]],
  // qa-64 round 2
  ['R2-1', `Closes #1\n\n- item\n    ${F4}\n  ${F}\n    ${F4}\n  Closes #2\n`, [1, 2]],
  ['R2-2', `Closes #1\n\n- item\n    ${F4}\n  <!--\n    ${F4}\n  Closes #2\n`, [1, 2]],
  ['R2-3', `Closes #1\n\n1. item\n     ${F4}\n   ${F}\n     ${F4}\n   Closes #2\n`, [1, 2]],
  // security-46
  ['S-1', `Closes #1\n\n1. a\n\n  ${F}\n${F}\nCloses #2\n  ${F}\n`, [1, 2]],
  ['S-2', `Closes #1\n\n1. a\n\n  ${F}\n<!--\n  ${F}\nCloses #2\n-->\n`, [1, 2]],
  ['S-3', 'Closes #1\n\n- a\n***bold*** text\n\n    Closes #2\n', [1, 2]],
  ['S-4', `Closes #1\n\n> - a\n>     ${F4}\n>   x\nCloses #2\n`, [1, 2]],
  ['S-5', `Closes #1\n\n> intro\n> - a\n>     ${F4}\n>   x\nCloses #2\n`, [1, 2]],
  ['S-6', 'Closes #1\n\n- <pre>\n\n  `Closes #2`\n  </pre>\n', [1, 2]],
  ['S-7', 'Closes #1\n\n- a\n\n    <pre>\n\n  `Closes #2`\n  </pre>\n', [1, 2]],
  ['S-8', 'Closes #1\n\na `b\n<span>\nc` Closes #2 `d`\n', [1, 2]],
  ['S-9', 'Closes #1\n\npara\n<span>\n<pre>\n\n`Closes #2`\n</pre>\n', [1, 2]],
  ['S-10', 'Closes #1\n\n- a\n\n    <!--\n\n  x -->`Closes #2`\n', [1, 2]],
  ['S-11', `Closes #1\n\n- a\n  - b\n      ${F4}\n    ${F}\n      ${F4}\n    Closes #2\n`, [1, 2]],
  ['S-12', `Closes #1\n\n-\ta\n\t  ${F4}\n\t${F}\n\t  ${F4}\n\tCloses #2\n`, [1, 2]],
  ['S-13', 'Closes #1\n\n- a\n\n    Closes #2\n', [1, 2]],
  ['S-14', 'Closes #1\n\n- a\n\nb\n\n    Closes #2\n', [1, 2]], // cm hides: over-count accepted
  ['S-15', `Closes #1\n\n-\n    ${F4}\n  ${F}\n    ${F4}\n  Closes #2\n`, [1, 2]],
  ['S-16', 'Closes #1\n\n* a\n    ~~~~\n  ~~~\n    ~~~~\n  Closes #2\n', [1, 2]],
  ['S-17', `Closes #1\n\n1) a\n     ${F4}\n   ${F}\n     ${F4}\n   Closes #2\n`, [1, 2]],
  ['S-18', 'Closes #1\n\n- a\n    <!--\n  > x\n    -->\n  Closes #2\n', [1, 2]],
  ['S-19', `Closes #1\n\n> - a\n>   ${F}\nCloses #2\n`, [1, 2]],
  ['S-20', 'Closes #1\n\n- item\n    <div>\n  `Closes #2`\n', [1, 2]],
  ['S-21', `Closes #1\n\n- item\n    ${F4}\n  > z\n    ${F4}\n  Closes #2\n`, [1, 2]],
  ['S-22', `Closes #1\n\n- a\n\n  b\n\n    ${F4}\n  ${F}\n    ${F4}\n  Closes #2\n`, [1, 2]],
  ['S-23', `Closes #1\n\n<foo bar\n${F}\n\nx\n${F}\nCloses #2\n${F}\n`, [1, 2]],
  ['S-24', `Closes #1\n\npara\n<span>\n<!--\n\n${F}\n-->\nCloses #2\n${F}\n`, [1, 2]],
  ['S-25', 'Closes #1 [^1]\n\n[^1]: note\n\n    Closes #2\n', [1, 2]], // GFM footnote
  ['S-26', 'Closes #1\n\n> a\n>\n>     x\nCloses #2\n', [1, 2]],
  ['S-27', 'Closes #1\n\n> <div>\n> x\nCloses #2\n', [1, 2]],
  // Before any list, the scanner still hides what GitHub hides.
  ['S-28', `Closes #1\n\n${F}\nCloses #2\n${F}\n`, [1]],
  ['S-29', 'Closes #1\n\n<!--\nCloses #2\n-->\n', [1]],
  ['S-30', 'Closes #1\n\nsee `Closes #2`\n', [1]],
];

test('security-46 probe table: 41 bodies', () => {
  assert.equal(PROBES.length, 41);
  for (const [id, body, want] of PROBES) assert.deepEqual(nums(body), want, id);
});

test('every probe that shows #2 makes the PR fail closed', () => {
  for (const [id, body, want] of PROBES) {
    assert.equal(closedIssue(body), want.length === 1 ? 1 : null, id);
  }
});

test('the latch: raw from the first list or footnote line, entities still decoded', () => {
  // Before the latch a fence hides; after it the same fence hides nothing.
  assert.deepEqual(nums(`Closes #1\n${F}\nCloses #2\n${F}\n- x\n${F}\nCloses #3\n${F}`), [1, 3]);
  // Inline code and comments are not stripped after the latch.
  assert.deepEqual(nums('Closes #1\n\n- x\n\n`Closes #2` <!-- Closes #3 -->'), [1, 2, 3]);
  // Quotes and indented code hide nothing after it.
  assert.deepEqual(nums('Closes #1\n\n1) x\n\n> Closes #2\n\n    Closes #3'), [1, 2, 3]);
  // Character references are still decoded.
  assert.deepEqual(nums('Closes #1\n\n- x\nClo&#115;es &#35;2'), [1, 2]);
  // The latch line itself is read raw, and the latch never resets.
  assert.deepEqual(nums('Closes #1\n\n> - `Closes #2`\n\n\n# h\n\n<!-- Closes #3 -->'), [1, 2, 3]);
  // A footnote definition latches too, also with an empty label.
  assert.deepEqual(nums('Closes #1\n\n[^]: x\n<!-- Closes #2 -->'), [1, 2]);
});

test('an HTML block that ends at a blank line latches on a fence, comment or type 1-5 start', () => {
  for (const opener of [F, '~~~', '<!--', '<pre>', '<script>', '<?x', '<!DOCTYPE', '<![CDATA[']) {
    assert.deepEqual(nums(`Closes #1\n\n<div>\n${opener}\n\nCloses #2\n`), [1, 2], opener);
  }
  // A type 6/7 line inside the HTML block does not latch.
  assert.deepEqual(nums('Closes #1\n\n<div>\n<span>\n</div>\n\n`Closes #2`\n'), [1]);
});

// Merged PR bodies #205, #217, #224 and #225, reduced to their structure: attribution comment,
// signature, one Closes line, template headings, task lists, nested lists with code spans and
// issue mentions without keywords, and fences listing paths and commands.
const ATTRIBUTION = '<!-- claude-projects-attribution: {"github_login":"x"} -->';
const shape = (n, extra) =>
  [
    ATTRIBUTION,
    '_Requested by **someone** · [project thread](https://claude.ai/x)_',
    '',
    '**[agent: platform-1 · role: platform]**',
    '',
    `Closes #${n}`,
    '',
    '## Summary',
    '',
    ...extra,
    '',
    '## Changed paths',
    '',
    '- [x] I confirm `git diff --name-only origin/main...HEAD` is inside the Touches',
    '',
    F,
    'scripts/touches-guard.mjs',
    'scripts/test/touches-guard-markdown.test.mjs',
    F,
    '',
    '## Acceptance criteria',
    '',
    '- [x] Globs come only from list items → `globs come from -, *, + and numbered list items`',
    '- [x] Prose under Touches is ignored (#191) → `prose lines under Touches are ignored`',
    '',
    '## Test evidence',
    '',
    F,
    'node --test scripts/test/touches-guard*.test.mjs   # 60 pass',
    'pnpm lint:scripts                                  # OK',
    F,
    '',
    '## Review matrix (PROMPT.md §11.2): rows that apply',
    '',
    '- [x] Peer review (`review:peer`), always',
    '- [ ] Contract / public API / boundaries → `review:architect`',
    '',
    '🤖 Generated with [Claude Code](https://claude.com/claude-code)',
  ].join('\n');

test('bodies shaped like merged PRs #205, #217, #224 and #225 still close one issue', async () => {
  const bodies = {
    205: shape(191, [
      '- `parseTouches` reads code spans only from list items (#148, #191).',
      '- `plainLines()`: ignores indented code and quotes, as on #101.',
      '',
      '**Found while doing this, filed as a follow-up:** see #208.',
    ]),
    217: shape(196, [
      'The `lock` job in `bootstrap-lockfile` now checks the graph (see #177).',
      '',
      '- **No aliases.** A `specifier` like `npm:foo@1` is refused:',
      '  - a `resolution` with `tarball` outside the registry fails;',
      '  - `{integrity: ...}` must be sha512.',
      '- **JSR.** `jsr:` and `@jsr/` are refused, as in #190.',
    ]),
    224: shape(212, [
      'Adds a DECISIONS entry. It records `singleLineText` engine behaviour.',
      '',
      F,
      'node -e "console.log(/\\p{L}/u.test(x))"',
      F,
      'Follow-up: issue #237 tracks the rest.',
    ]),
    225: shape(210, [
      '- `FORBIDDEN_NAMES` is matched after NFKC and case folding.',
      '  1. `Package.JSON` and `ｐackage.json` are refused;',
      '  2. related to #192.',
    ]),
  };
  const want = { 205: 191, 217: 196, 224: 212, 225: 210 };
  for (const [pr, body] of Object.entries(bodies)) {
    assert.equal(closedIssue(body), want[pr], `#${pr}`);
    const r = await evaluateTouches({
      user: { login: 'Wetterbro', type: 'User', id: 47597724 },
      number: Number(pr),
      body,
      files: ['scripts/touches-guard.mjs'],
      issueBody: (n) => ({
        number: n,
        repository_url: 'https://api.github.com/repos/o/r',
        author_association: 'COLLABORATOR',
        labels: [{ name: 'agent:platform-1' }],
        body: '## Touches\n- `scripts/**`\n',
      }),
    });
    assert.equal(r.ok, true, `#${pr}: ${r.lines.join('\n')}`);
  }
});

test('advice: after a list, mention other issues without a closing keyword', () => {
  assert.equal(closedIssue('Closes #1\n\n- done\n\nSee #18. Related: issue #19.'), 1);
  assert.equal(closedIssue('Closes #1\n\n- done\n\n```\nCloses #18\n```'), null);
});
