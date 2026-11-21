#!/usr/bin/env node
// tenant-guard (PROMPT.md §6 "Single dependency root"): tenants are data only.
// Fails if anything under tenants/ could add code, dependencies or external loads.
// The built-page CSP/origin check is added with the CLI build (M5).
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { walk } from './lib/fs-walk.mjs';

export const ALLOWED_EXT = new Set([
  '.yaml',
  '.yml',
  '.md',
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.avif',
  '.woff2',
]);
const ALLOWED_NAMES = new Set(['.gitkeep', 'README.md']);
// The only folders allowed directly inside a tenant folder (PROMPT.md §4 layout). Matched exactly and
// case-sensitively: on a case-insensitive checkout "Assets/" would resolve to "assets/" yet escape
// every assets/ rule below.
export const TENANT_FOLDERS = new Set(['assets', 'content']);
export const FORBIDDEN_NAMES = [
  /^package\.json$/i,
  /^package-lock\.json$/i,
  /^pnpm-lock\.yaml$/i,
  /^pnpm-workspace\.yaml$/i,
  /^yarn\.lock$/i,
  /^bun\.lockb?$/i,
  /^npm-shrinkwrap\.json$/i,
  /^\.npmrc$/i,
  /^\.yarnrc(\.yml)?$/i,
  /^\.pnpmfile\.cjs$/i,
  /^node_modules$/i,
  /^import-?map\.json$/i,
  /^deno\.jsonc?$/i,
  /^Makefile$/i,
  /^Dockerfile$/i,
];
// One path segment under assets/. Must stay identical to SEGMENT in
// packages/schema/src/primitives/asset-ref.ts so every shipped file can be referenced by an AssetRef.
export const ASSET_SEGMENT = /^[a-z0-9][a-z0-9._-]*$/;
const ASSETS_PATH = /^[^/]+\/assets\/.+/;
const TEXT_EXT = new Set(['.yaml', '.yml', '.md']);
const MAX_TEXT_BYTES = 1_000_000;

// Character references a browser or remark-parse decodes inside a URL or attribute. Named ones are
// matched case-insensitively (fail closed: "&COLON;" is not a real entity, but treating it as one
// costs nothing). Unknown names are left as they are.
const NAMED_REFS = {
  colon: ':',
  tab: '\t',
  newline: '\n',
  sol: '/',
  lpar: '(',
  rpar: ')',
  equals: '=',
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
  amp: '&',
  nbsp: '\u00a0',
};
// HTML character references (";" is optional, as in browsers' legacy parsing) and backslash
// escapes: YAML double-quoted escapes (\xXX, \uXXXX, \UXXXXXXXX, \t, an escaped line break) and
// Markdown backslash-escaped punctuation ("javascript\:" is a javascript: link destination).
const ESCAPE =
  /&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([a-zA-Z][a-zA-Z0-9]*));?|\\(?:[xX]([0-9a-fA-F]{2})|U([0-9a-fA-F]{8})|u([0-9a-fA-F]{4})|(\r?\n[ \t]*)|([\s\S]))/g;
const YAML_ESCAPES = {
  0: '\0',
  a: '\x07',
  b: '\b',
  t: '\t',
  n: '\n',
  v: '\v',
  f: '\f',
  r: '\r',
  e: '\x1b',
  N: '\x85',
  _: '\xa0',
  L: '\u2028',
  P: '\u2029',
};
// Removed before the decoded check: browsers drop tab, LF and CR anywhere in a URL and leading C0
// controls; we also drop every other control and invisible format character (fail closed).
// eslint-disable-next-line no-control-regex -- matching control characters is the point here
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff]/;
const DECODE_ROUNDS = 3;

function fromCodePoint(n) {
  return Number.isSafeInteger(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '\ufffd';
}

/**
 * Decodes HTML character references and backslash escapes (up to DECODE_ROUNDS rounds, so
 * "&amp;#58;" also becomes ":"). Returns two views of `text`: `decoded`, and `stripped`, which is
 * `decoded` without control and invisible characters (a tab or newline inside a URL scheme is
 * ignored by browsers, but a tab between attributes is a separator, so both views are scanned).
 * Each view has, for each of its UTF-16 units, the index in `text` it came from (`map`), so a match
 * is reported on the right line.
 */
export function normalizeForScan(text) {
  let s = text;
  let map = Array.from({ length: text.length }, (_, i) => i);
  for (let round = 0; round < DECODE_ROUNDS; round++) {
    let out = '';
    const outMap = [];
    let last = 0;
    for (const m of s.matchAll(ESCAPE)) {
      let rep;
      if (m[1] !== undefined) rep = fromCodePoint(Number(m[1]));
      else if (m[2] !== undefined) rep = fromCodePoint(parseInt(m[2], 16));
      else if (m[3] !== undefined) rep = NAMED_REFS[m[3].toLowerCase()];
      else if (m[4] ?? m[5] ?? m[6]) rep = fromCodePoint(parseInt(m[4] ?? m[5] ?? m[6], 16));
      else if (m[7] !== undefined)
        rep = ''; // YAML escaped line break: joined, indent dropped
      else rep = YAML_ESCAPES[m[8]] ?? m[8];
      if (rep === undefined) continue;
      out += s.slice(last, m.index);
      for (let i = last; i < m.index; i++) outMap.push(map[i]);
      out += rep;
      for (let i = 0; i < rep.length; i++) outMap.push(map[m.index]);
      last = m.index + m[0].length;
    }
    if (last === 0) break;
    out += s.slice(last);
    for (let i = last; i < s.length; i++) outMap.push(map[i]);
    s = out;
    map = outMap;
  }
  let out = '';
  const outMap = [];
  for (let i = 0; i < s.length; i++) {
    if (INVISIBLE.test(s[i])) continue;
    out += s[i];
    outMap.push(map[i]);
  }
  return { decoded: { text: s, map }, stripped: { text: out, map: outMap } };
}

// A CommonMark autolink is never raw HTML, so these are the only "<" + letter forms allowed:
// <https:…>, <mailto:…>, <tel:…> (no whitespace, "<" or ">" inside) and <name@example.com>.
// The email local part is narrower than CommonMark's on purpose ("/" and "=" are left out).
const AUTOLINK = String.raw`(?:https|mailto|tel):[^\s<>]*>|[a-z0-9._%+-]+@[a-z0-9.-]+>`;

// Content rules for YAML/Markdown. Tenants refer to platform components by name only.
// ADR 0002 allows no raw HTML in tenant Markdown, so any tag fails (`html-tag`). The narrower HTML
// rules stay as defence in depth with a more specific message. A rule with `decoded: true` is also
// run on normalizeForScan(text), which catches entity-encoded and control-character-split payloads.
export const CONTENT_RULES = [
  {
    id: 'html-tag',
    re: new RegExp(String.raw`<(?!${AUTOLINK})[a-z!/?]`, 'i'),
    msg: 'Raw HTML (tags, comments, <!…> or <?…>) is not allowed in tenant content (ADR 0002), also not inside code spans. Use Markdown or a platform section type. Allowed: the autolinks <https://…>, <mailto:…>, <tel:…> and <name@example.com>. To show a literal "<", write "&lt;" or put a space after it.',
  },
  {
    id: 'html-script',
    re: /<\s*script\b/i,
    msg: 'HTML <script> tags are not allowed in tenant content.',
  },
  {
    id: 'html-embed',
    re: /<\s*(iframe|object|embed|link|style|meta|base|form|svg|math)\b/i,
    msg: 'Raw HTML embeds are not allowed. Use a platform section type instead.',
  },
  {
    id: 'event-handler',
    re: /[\s/"']on[a-z]+\s*=/i,
    decoded: true,
    msg: 'Inline event handlers (onclick=…) are not allowed. In plain text, rephrase so that a word starting with "on" is not followed by "=".',
  },
  {
    id: 'js-url',
    re: /(?<![a-z0-9+.-])(javascript|vbscript|data)\s*:/i,
    decoded: true,
    msg: 'javascript:, vbscript: and data: URLs are not allowed, also not when written with character references (&#58;, &colon;, &#x61;) or split by tabs, newlines or invisible characters. Allowed schemes: https:, mailto:, tel:.',
  },
  {
    id: 'insecure-url',
    re: /\bhttp:\/\//i,
    msg: 'Plain http:// URLs are not allowed. Use https://.',
  },
  {
    id: 'external-asset',
    re: /https:\/\/[^\s"'<>)]+\.(m?js|cjs|css|woff2?|ttf|otf|eot)(\?[^\s"'<>)]*)?(?=$|[\s"'<>)])/im,
    msg: 'External scripts, styles or fonts are not allowed. Everything must be bundled by the platform.',
  },
  {
    id: 'font-cdn',
    re: /https:\/\/(fonts\.(googleapis|gstatic)\.com|use\.typekit\.net|fonts\.bunny\.net)/i,
    msg: 'Font CDNs are not allowed. Fonts are self-hosted WOFF2 (Q4.3).',
  },
  {
    id: 'module-import',
    re: /^\s*(import\s.+\sfrom\s|import\s*\(|require\s*\(|export\s+(default|const|function)\b)/m,
    msg: 'Tenant files may not import or export modules.',
  },
];

/**
 * Index in `text` of the first match of `rule`, or -1. A rule with `decoded: true` is tested on the
 * raw text and on both views from normalizeForScan, and the earliest source position wins.
 */
export function findRule(rule, text, normalized = rule.decoded ? normalizeForScan(text) : null) {
  const raw = rule.re.exec(text);
  let pos = raw ? raw.index : -1;
  if (rule.decoded && normalized) {
    for (const view of [normalized.decoded, normalized.stripped]) {
      const m = rule.re.exec(view.text);
      if (!m) continue;
      const src = view.map[m.index];
      if (pos === -1 || src < pos) pos = src;
    }
  }
  return pos;
}

/**
 * Escapes control characters (JSON style) so a file name or file content can never add lines to the
 * CI log, e.g. a fake "::error::" workflow command. Everything printed from a tenant goes through this.
 */
export function safe(text) {
  return JSON.stringify(String(text))
    .slice(1, -1)
    .replace(
      /[\u007f-\u009f\u2028\u2029]/g,
      (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
    );
}

function ext(path) {
  const base = path.split('/').pop() ?? '';
  const i = base.lastIndexOf('.');
  return i > 0 ? base.slice(i).toLowerCase() : '';
}

function suggest(name) {
  const s = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/^[^a-z0-9]+/, '');
  return s || 'file';
}

/** Returns a list of { path, rule, message } problems for the tenants root. */
export function checkTenants(root) {
  const problems = [];
  for (const e of walk(root)) {
    const parts = e.path.split('/');
    const rawName = parts[parts.length - 1];
    const name = safe(rawName);
    const at = `tenants/${safe(e.path)}`;
    if (e.isSymlink) {
      problems.push({
        path: at,
        rule: 'symlink',
        message: 'Symlinks are not allowed in tenants/ (they can escape tenant isolation).',
      });
      continue;
    }
    if (FORBIDDEN_NAMES.some((re) => re.test(rawName))) {
      problems.push({
        path: at,
        rule: 'forbidden-file',
        message: `"${name}" is not allowed. Tenants have no dependencies, package files or build steps; the platform provides everything.`,
      });
      continue;
    }
    if (
      ASSETS_PATH.test(e.path) &&
      !ALLOWED_NAMES.has(rawName) &&
      (!ASSET_SEGMENT.test(rawName) || rawName.includes('..'))
    ) {
      problems.push({
        path: at,
        rule: 'asset-name',
        message: `"${name}" is not a valid asset name. Names under assets/ must be lowercase letters, digits, "-", "_" or "." and start with a letter or digit (no spaces, uppercase or non-ASCII), or no AssetRef can point to it. Rename it, e.g. "${suggest(rawName)}".`,
      });
      continue;
    }
    if (e.isDir) {
      if (parts.length === 2 && !TENANT_FOLDERS.has(rawName)) {
        problems.push({
          path: at,
          rule: 'tenant-folder',
          message: `"${name}" is not an allowed folder in a tenant. Allowed, spelled exactly like this: ${[...TENANT_FOLDERS].join(', ')}. Rename or remove it (on a case-insensitive checkout "Assets" would also resolve to "assets").`,
        });
      }
      continue;
    }
    if (!ALLOWED_NAMES.has(rawName) && !ALLOWED_EXT.has(ext(rawName))) {
      problems.push({
        path: at,
        rule: 'file-type',
        message: `File type "${safe(ext(rawName)) || name}" is not allowed. Allowed: ${[...ALLOWED_EXT].join(' ')}.`,
      });
      continue;
    }
    if (TEXT_EXT.has(ext(rawName))) {
      if (e.size > MAX_TEXT_BYTES) {
        problems.push({
          path: at,
          rule: 'size',
          message: `Text file is larger than ${MAX_TEXT_BYTES} bytes.`,
        });
        continue;
      }
      const text = readFileSync(e.full, 'utf8');
      const lines = text.split('\n');
      const normalized = normalizeForScan(text);
      for (const rule of CONTENT_RULES) {
        const pos = findRule(rule, text, normalized);
        if (pos !== -1) {
          const line = text.slice(0, pos).split('\n').length;
          problems.push({
            path: `${at}:${line}`,
            rule: rule.id,
            message: `${rule.msg} Found: "${safe((lines[line - 1] ?? '').trim().slice(0, 80))}"`,
          });
        }
      }
    }
  }
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = process.argv[2] ?? 'tenants';
  const problems = checkTenants(root);
  if (problems.length) {
    console.error(`tenant-guard: ${problems.length} problem(s)\n`);
    // Every path and message is escaped with safe() when it is built (names come from tenants).
    for (const p of problems) console.error(`  ✗ ${p.path}  [${p.rule}]\n    ${p.message}\n`);
    process.exit(1);
  }
  console.log('tenant-guard: OK');
}
