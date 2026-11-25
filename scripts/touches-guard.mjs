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
// One closing reference (#208): GitHub closes every issue a PR body names with Closes, Fixes or
// Resolves, so every such reference is collected (see closingRefs) and the PR fails unless they
// all name the same plain "#n". Markdown is read fail-closed in two directions: for Closes,
// only text GitHub certainly hides (code, quotes, comments) is ignored; for Touches, anything
// GitHub might hide is ignored.
//
// Raw after the first list (#208, security-46's decision on PR #230): indentation inside list
// items and footnotes depends on a content column this guard does not track, so for Closes the
// body is read raw from the first line that could open a list item (also inside a quote) or a
// GFM footnote definition, or that opens a fence, comment or HTML block of types 1-5 inside an
// HTML block ending at a blank line. From there nothing hides a reference: no fence, indented
// code, quote, comment or inline code span; only character references are decoded. Authors:
// after a list, mention other issues without a closing keyword ("issue #18", "see #18").
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

/** Columns of whitespace from `col` on (a tab advances to the next multiple of 4, as in CommonMark). */
function indentWidth(line, col = 0) {
  const start = col;
  for (const ch of line) {
    if (ch === ' ') col += 1;
    else if (ch === '\t') col += 4 - (col % 4);
    else break;
  }
  return col - start;
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
/** One or more list markers at the start of a line ("- ", "1. ", "- 2) "). */
const LIST_PREFIX = /^ {0,3}(?:(?:[-*+]|\d{1,9}[.)])(?:[ \t]+|$))+/;

/** `{ ch, len }` when `line` (after `prefix`) opens a fenced code block, else null. */
function fenceOpen(line, prefix = /^/) {
  const m = FENCE_OPEN.exec(line.replace(prefix, ''));
  if (!m || (m[1][0] === '`' && m[2].includes('`'))) return null;
  return { ch: m[1][0], len: m[1].length };
}

/**
 * How an HTML block that starts on `line` ends (CommonMark types 1–7, read widely):
 * `{ comment: true }` for `<!--`, `{ end: RegExp }` for the types that end at a marker, or
 * `{ end: null }` for those that end at a blank line. Null when the line starts no HTML block.
 * Types 6 and 7 are widened to any `<tag` or `</tag` at the start of a line.
 */
function htmlStart(line) {
  const t = /^ {0,3}(<.*)$/.exec(line)?.[1];
  if (!t) return null;
  if (t.startsWith('<!--')) return { comment: true };
  const marker = [
    [/^<(?:pre|script|style|textarea)(?=[\s>]|$)/i, /<\/(?:pre|script|style|textarea)>/i],
    [/^<\?/, /\?>/],
    [/^<!\[CDATA\[/, /\]\]>/],
    [/^<![A-Za-z]/, />/],
  ].find(([open]) => open.test(t));
  if (marker) {
    const rest = t.slice(marker[0].exec(t)[0].length);
    return { end: marker[1], endsHere: marker[1].test(rest) };
  }
  return /^<\/?[A-Za-z]/.test(t) ? { end: null } : null;
}

/**
 * True when `line` could interrupt a paragraph, so it cannot be a lazy continuation line of a
 * blockquote. Deliberately wider than CommonMark (any indentation, any list number, empty list
 * items, every `<`, tables, footnotes, math): ending a quote too early shows more text, which is
 * the fail-closed direction for Closes.
 */
function interruptsParagraph(line) {
  const t = line.replace(/^[ \t]+/, '');
  return (
    /^#{1,6}(?:[ \t]|$)/.test(t) || // ATX heading
    /^(?:`{3,}|~{3,})/.test(t) || // fenced code
    t.startsWith('<') || // HTML block
    t.startsWith('>') || // blockquote
    /^(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/.test(t) || // list item
    /^(?:([-*_])(?:[ \t]*\1){2,}|=+|-+)[ \t]*$/.test(t) || // thematic break, setext underline
    t.startsWith('|') ||
    (/^[|:\- \t]+$/.test(t) && t.includes('-')) || // table delimiter row
    t.startsWith('$$') ||
    t.startsWith('[^')
  );
}

/**
 * A line that could open a list item (also inside blockquotes) or a GFM footnote definition.
 * Inside those, indentation is measured from a content column this guard does not track.
 */
const CONTAINER_LINE = /^[ \t>]*(?:(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)|\[\^[^\]]*\]:)/;

/** CommonMark blank line: only spaces and tabs (NBSP, VT, FF and other Unicode spaces are text). */
const isBlank = (line) => /^[ \t]*$/.test(line);

/** Text of a quoted line with every `>` marker (and the optional space after it) removed. */
function unquote(line) {
  let s = line;
  for (let m; (m = /^ {0,3}> ?/.exec(s)); ) s = s.slice(m[0].length);
  return s;
}

/**
 * True when quoted `content` certainly leaves a paragraph open (so the next unmarked line may
 * be a lazy continuation). Unsure cases say false.
 */
function opensParagraph(content) {
  if (isBlank(content) || indentWidth(content) >= 4) return false;
  const item = /^ {0,3}(?:[-*+]|\d{1,9}[.)])[ \t]+(.*)$/.exec(content);
  if (item) return opensParagraph(item[1]);
  return !interruptsParagraph(content);
}

/**
 * Where an HTML comment that is open at `from` in `line` ends: `{ rest, blockEnds }`, or null
 * when it does not end on this line. `rest` is the text after the comment; `blockEnds` says
 * whether the CommonMark HTML block (which ends at the first line containing `-->`) ends too.
 * Closes mode (`touches` false) ends the comment at the earliest point any HTML parser would
 * (`-->` or `--!>`, including `<!-->`), so hidden text is never over-counted. Touches mode ends
 * it only at a `-->` after the opening `<!--`, so hidden list items are never counted.
 */
function commentEnd(line, from, touches) {
  const ends = touches ? ['-->'] : ['-->', '--!>'];
  let best = null;
  for (const e of ends) {
    const i = line.indexOf(e, from);
    if (i >= 0 && (!best || i < best.i)) best = { i, len: e.length };
  }
  if (!best) return null;
  return { rest: line.slice(best.i + best.len), blockEnds: line.includes('-->', from) };
}

/**
 * Block-level scan of Markdown in one pass, so fences, HTML comments, HTML blocks, blockquotes
 * and indented code cannot hide each other (#148, #191, #208). Returns one entry per line:
 * kind `plain` (Markdown text), `html` (raw HTML: shown, but not parsed as Markdown), `hidden`
 * (code, comment or quote), `blank`, or `raw` (closes mode, after the latch below).
 *
 * Mode `closes` hides only what GitHub certainly does not render as text: an extra reference
 * fails closed, a missed one would not. Mode `touches` hides everything GitHub might not render
 * as a list item: a missed glob fails closed, an extra one would not. They differ in:
 * - blockquotes: `closes` follows CommonMark lazy continuation (a line that could interrupt a
 *   paragraph ends the quote); `touches` hides until the next blank line;
 * - HTML comments: `closes` hides only comments that start a line; `touches` hides from any
 *   `<!--`, also mid-line and after list markers, and to the end of the body when unclosed;
 * - fences and HTML blocks after list markers (`- ```js`) are recognised only in `touches`;
 * - indented code (4+ columns) is hidden only when it cannot continue a paragraph or a list
 *   item: after a blank line (or at the start), and only before any list item has been seen;
 * - `closes` latches (`nested`) on the first line matching `CONTAINER_LINE`, or opening a fence,
 *   comment or HTML block of types 1-5 inside an HTML block that ends at a blank line. That
 *   check runs in every state. From the latch line on, every line is `raw` and the latch never
 *   resets: inside lists and footnotes indentation is relative to a content column the scanner
 *   does not track, and one misread construct would hide everything after it.
 */
function scanBlocks(text, mode) {
  const touches = mode === 'touches';
  const out = [];
  const push = (t, kind) => out.push({ text: t, kind });
  const prefix = touches ? LIST_PREFIX : /^/;
  let fence = null; // { ch, len }
  let html = null; // { end: RegExp | null }
  let comment = false;
  let nested = false; // closes mode: latched on the first container line (#208)
  let quote = null; // { para: boolean, noLazy: boolean }
  let inCode = false;
  let listOpen = false;
  let prevBlank = true;
  for (const line of String(text ?? '').split(/\r\n|\r|\n/)) {
    const blank = isBlank(line);
    // Closes mode latch (security-46's decision on PR #230): from the first line that could open
    // a list item or footnote, or that opens a fence, comment or HTML block of types 1-5 inside
    // an HTML block ending at a blank line, every line is raw text. Checked in every state.
    if (!touches && !nested) {
      if (CONTAINER_LINE.test(line)) nested = true;
      else if (html && html.end === null) {
        const h2 = htmlStart(line);
        if (fenceOpen(line) || (h2 && (h2.comment || h2.end))) nested = true;
      }
    }
    if (nested) {
      push(line, 'raw');
      continue;
    }
    if (fence) {
      const c = FENCE_CLOSE.exec(line);
      if (c && c[1][0] === fence.ch && c[1].length >= fence.len) fence = null;
      push('', 'hidden');
      continue;
    }
    if (comment) {
      const e = commentEnd(line, 0, touches);
      if (!e) {
        push('', 'hidden');
        continue;
      }
      comment = false;
      if (!e.blockEnds) html = { end: /-->/ };
      push(e.rest, 'html');
      prevBlank = false;
      continue;
    }
    if (html) {
      if (html.end ? html.end.test(line) : blank) html = null;
      push(blank ? '' : line, blank ? 'blank' : 'html');
      prevBlank = blank;
      continue;
    }
    if (blank) {
      quote = null;
      prevBlank = true;
      push('', 'blank');
      continue;
    }
    if (/^ {0,3}>/.test(line)) {
      const content = unquote(line);
      const bare = content.replace(LIST_PREFIX, '');
      const noLazy = (quote?.noLazy ?? false) || !!fenceOpen(bare) || !!htmlStart(bare);
      const para =
        !noLazy &&
        (quote?.para && !isBlank(content) && !interruptsParagraph(content)
          ? true
          : opensParagraph(content));
      quote = { para, noLazy };
      inCode = false;
      prevBlank = false;
      push('', 'hidden');
      continue;
    }
    if (quote) {
      if (touches || (quote.para && !interruptsParagraph(line))) {
        push('', 'hidden'); // lazy continuation of the quoted paragraph
        prevBlank = false;
        continue;
      }
      quote = null;
    }
    const f = fenceOpen(line, prefix);
    if (f) {
      fence = f;
      inCode = false;
      prevBlank = false;
      push('', 'hidden');
      continue;
    }
    const h = htmlStart(line.replace(prefix, ''));
    if (h) {
      inCode = false;
      prevBlank = false;
      if (h.comment) {
        const at = line.indexOf('<!--');
        const e = commentEnd(line, at + (touches ? 4 : 2), touches);
        if (!e) {
          comment = true;
          push('', 'hidden');
          continue;
        }
        if (!e.blockEnds) html = { end: /-->/ };
        push(e.rest, 'html');
        continue;
      }
      if (!h.endsHere) html = { end: h.end };
      push(line, 'html');
      continue;
    }
    if (indentWidth(line) >= 4 && (inCode || (prevBlank && !listOpen))) {
      inCode = true;
      prevBlank = false;
      push('', 'hidden');
      continue;
    }
    inCode = false;
    if (LIST_PREFIX.test(line)) listOpen = true;
    else if (
      indentWidth(line) === 0 &&
      (prevBlank || /^(?:#{1,6}(?:[ \t]|$)|[-*_]{3})/.test(line))
    ) {
      listOpen = false;
    }
    prevBlank = false;
    if (touches && line.includes('<!--')) {
      // Mid-line comment: hide from `<!--` to its `-->`, which may be on a later line.
      let rest = line;
      let kept = '';
      for (let i; (i = rest.indexOf('<!--')) >= 0; ) {
        kept += rest.slice(0, i);
        const e = commentEnd(rest, i + 4, true);
        if (!e) {
          comment = true;
          rest = '';
          break;
        }
        rest = e.rest;
      }
      push(kept + rest, 'plain');
      continue;
    }
    push(line, 'plain');
  }
  return out;
}

/**
 * Markdown with fenced and indented code, HTML comments and blockquotes blanked out (#148,
 * #191, #208), as `scanBlocks` reads it for Closes. Raw HTML blocks are kept, because GitHub
 * shows their text. Line count is kept.
 */
export function plainLines(text) {
  return scanBlocks(text, 'closes')
    .map((l) => (l.kind === 'plain' || l.kind === 'html' ? l.text : ''))
    .join('\n');
}

const ASCII_PUNCT = /[!-/:-@[-`{-~]/;

/**
 * Inline code spans and HTML comments in one line of a paragraph, blanked with spaces.
 * `doubt` is true when the line has something that could make GitHub read it differently from
 * this line-local view: a backtick run with no partner on the line (a span may cross lines), any
 * other `<` (raw HTML and autolinks take precedence over code spans), an HTML comment that is not
 * valid in both CommonMark 0.29 and 0.31, or a `|` inside a span (a GFM table splits cells first).
 */
function inlineScan(line) {
  let out = '';
  let doubt = false;
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    if (c === '\\' && ASCII_PUNCT.test(line[i + 1] ?? '')) {
      out += line.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (c === '`') {
      const n = /^`+/.exec(line.slice(i))[0].length;
      const re = /`+/g;
      re.lastIndex = i + n;
      let close = null;
      for (let m; (m = re.exec(line)); ) {
        if (m[0].length === n) {
          close = m.index;
          break;
        }
      }
      if (close === null) {
        doubt = true;
        out += line.slice(i, i + n);
        i += n;
        continue;
      }
      if (line.slice(i + n, close).includes('|')) doubt = true;
      out += ' '.repeat(close + n - i);
      i = close + n;
      continue;
    }
    if (c === '<') {
      const end = line.startsWith('<!--', i) ? line.indexOf('-->', i + 4) : -1;
      const inner = end >= 0 ? line.slice(i + 4, end) : '';
      if (end >= 0 && !/^-?>/.test(inner) && !inner.endsWith('-') && !inner.includes('--')) {
        out += ' '.repeat(end + 3 - i);
        i = end + 3;
        continue;
      }
      doubt = true;
    }
    out += c;
    i += 1;
  }
  return { text: out, doubt };
}

const NAMED_ENTITIES = {
  num: '#',
  nbsp: ' ',
  colon: ':',
  sol: '/',
  period: '.',
  lowbar: '_',
  ast: '*',
  lsqb: '[',
  lpar: '(',
  lt: '<',
  amp: '&',
  tab: '\t',
  newline: '\n',
};

/** Decode numeric and a few named character references once, as GitHub would render them. */
function decodeEntities(s) {
  return s.replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([A-Za-z]+));/g, (all, d, x, name) => {
    if (name) return NAMED_ENTITIES[name.toLowerCase()] ?? all;
    const cp = d ? Number(d) : parseInt(x, 16);
    return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : all;
  });
}

/**
 * A closing keyword and what follows it. The left and right edges, the separator (spaces,
 * emphasis, `:`, `\`, `<`, `[`, `(`, zero-width characters) and the targets are read widely, so
 * that anything GitHub might link is collected; only a plain `#n` is accepted later.
 */
const CLOSING_REF =
  /(?<![\p{L}\p{N}])(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)(?![\p{L}\p{N}])[\s*_~:\\<[(\u200B-\u200D\u2060\uFEFF]*(#(\d+)|gh-\d+|[\w.-]+\/[\w.-]+#\d+|https?:\/\/[^\s<>)\]]+)/giu;

/**
 * Every closing-keyword reference in a PR body that GitHub could link (#208): `Closes`,
 * `Fixes` or `Resolves` (any form, any case) followed by `#n`, `GH-n`, `owner/repo#n` or a URL.
 * References are read only from text GitHub renders as text: never from fenced or indented
 * code, blockquotes or HTML comments (#148, #191, #208), and never from an inline code span or
 * same-line comment, unless something in the paragraph puts that in doubt (see `inlineScan`), in
 * which case nothing in that paragraph is ignored. From the first line that could open a list
 * item or footnote definition (or a fence, comment or HTML type 1-5 block inside a blank-line
 * HTML block) to the end, the body is read raw: nothing is ignored and only character
 * references are decoded, because indentation inside lists and footnotes depends on a content
 * column the guard does not track. This over-counts, which fails closed: after a list, mention
 * other issues without a closing keyword ("issue #18", "see #18"). Each entry is
 * `{ ref, issue }`, where `issue` is the number for a plain `#n` and null for any other form.
 * @returns {{ ref: string, issue: number | null }[]}
 */
export function closingRefs(body) {
  const visible = [];
  let para = [];
  const flush = () => {
    const scanned = para.map(inlineScan);
    const doubt = scanned.some((s) => s.doubt);
    visible.push(...(doubt ? para : scanned.map((s) => s.text)));
    para = [];
  };
  for (const { text, kind } of scanBlocks(body, 'closes')) {
    if (kind === 'plain') {
      para.push(text);
      continue;
    }
    flush();
    visible.push(kind === 'html' || kind === 'raw' ? text : '');
  }
  flush();
  return [...decodeEntities(visible.join('\n')).matchAll(CLOSING_REF)].map((m) => ({
    ref: m[1],
    issue: m[2] != null ? Number(m[2]) : null,
  }));
}

/**
 * The one issue a PR body closes, or null when it names none, names more than one distinct
 * issue, or uses a reference other than a plain `#n` (#208: fail closed).
 */
export function closedIssue(body) {
  const refs = closingRefs(body);
  const issues = new Set(refs.map((r) => r.issue));
  if (refs.length === 0 || issues.size !== 1 || issues.has(null)) return null;
  return refs[0].issue;
}

/**
 * A Markdown list item (`-`, `*`, `+`, `1.` or `1)`, up to 3 leading spaces) and its text. More
 * than 4 columns after the marker make the text indented code inside the item, so it is not one.
 */
const LIST_ITEM = /^ {0,3}((?:[-*+]|\d{1,9}[.)]))([ \t]+)(.*)$/;
const TOUCHES_HEADING = /^#{2,3}\s*Touches\s*$/i;
/** Ends the Touches section: a heading at any level, a setext underline or a thematic break. */
const SECTION_END = /^ {0,3}(?:#{1,6}(?:[ \t]|$)|(?:([-*_])(?:[ \t]*\1){2,}|=+|-+)[ \t]*$)/;

/** The text of a Touches list item, or '' when the line is not one. */
function itemText(line) {
  const m = LIST_ITEM.exec(line);
  if (!m) return '';
  const col = /^ */.exec(line)[0].length + m[1].length;
  if (indentWidth(m[2], col) > 4 || m[3].startsWith('>')) return '';
  return m[3];
}

/**
 * Backticked globs from the "## Touches" section (markdown) or the "### Touches" issue-form
 * section. Globs are read only from list items, one or more inline code spans on the item's own
 * line; prose, quoted, indented and continuation lines are ignored, and a code span never
 * crosses a line break (#191). Fenced code, HTML comments and HTML blocks never supply a glob,
 * and a heading at any level ends the section (#148, #208). Unsure cases give fewer globs.
 */
export function parseTouches(body) {
  const globs = [];
  let state = 'before'; // 'before' | 'in' | 'after'
  for (const { text, kind } of scanBlocks(body, 'touches')) {
    if (state === 'before') {
      if (kind === 'plain' && TOUCHES_HEADING.test(text)) state = 'in';
      continue;
    }
    if (state === 'after') break;
    if (kind === 'html' && /^\s*<h[1-6](?=[\s>/]|$)/i.test(text)) state = 'after';
    if (kind !== 'plain') continue;
    if (SECTION_END.test(text)) {
      state = 'after';
      continue;
    }
    for (const x of itemText(text).matchAll(/`([^`\n]+)`/g)) {
      const g = x[1].trim();
      if (g) globs.push(g);
    }
  }
  return globs;
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
  const refs = closingRefs(body);
  if (!refs.length) {
    return {
      ok: false,
      lines: [
        '✗ PR body has no "Closes #<issue>". Every PR must close an issue (PROMPT.md §12.1).',
      ],
    };
  }
  const foreign = refs.filter((r) => r.issue == null);
  if (foreign.length) {
    return {
      ok: false,
      lines: [
        `✗ PR body closes ${foreign.map((r) => `"${r.ref}"`).join(', ')}, which is not a plain ` +
          '"#<issue>" reference. GitHub may close it, but touches-guard checks only an issue in ' +
          'this repository written as "Closes #<n>": rewrite it that way, or drop the closing ' +
          'keyword (e.g. "See owner/repo#5").',
      ],
    };
  }
  const issues = [...new Set(refs.map((r) => r.issue))];
  if (issues.length > 1) {
    return {
      ok: false,
      lines: [
        `✗ PR body closes ${issues.length} issues (${issues.map((i) => `#${i}`).join(', ')}). ` +
          'GitHub closes every one, but Touches are checked against one issue: close exactly ' +
          'one issue per PR and mention the others without a closing keyword (e.g. "Part of #n").',
      ],
    };
  }
  const n = issues[0];
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
