#!/usr/bin/env node
// check-path-aliases (#190): refuses tracked paths that some filesystem opens as a different
// path. review-gate matches its reviewed rows without regard to case (#162), but a checkout on
// macOS or Windows can still turn one committed name into another:
//   - Windows drops a trailing `.` or space from every path segment, so `.npmrc.` is `.npmrc`;
//   - macOS HFS+ ignores default-ignorable code points (zero-width joiners, U+FEFF, …) and
//     both HFS+ and APFS treat NFC and NFD spellings as one name;
//   - macOS and Windows are case-insensitive, so `.NPMRC` is `.npmrc` and `Docs/` is `docs/`.
// Any such path could carry a dependency or security file past the review it needs, so the
// check refuses it outright. The reviewed globs are imported from review-gate, never copied.
//
// Usage:
//   node scripts/check-path-aliases.mjs              # paths from `git ls-files` in the cwd
//   node scripts/check-path-aliases.mjs --tree <sha> # paths of that commit, via the GitHub
//                                                    # trees API (GITHUB_REPOSITORY, GITHUB_TOKEN)
// The CI job (pr-gates.yml) uses --tree with the PR head, so the PR is never checked out.
import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { foldCase, globToRegExp } from './lib/glob.mjs';
import { DEPENDENCY_PATHS, PACKAGE_MANIFESTS, RICHTEXT_PATHS } from './review-gate.mjs';

/**
 * The review-gate globs whose literal segments a committed path may not spell in another case.
 * DEPENDENCY_PATHS already includes ALT_MANIFESTS. The `security` row's globs are inline in
 * review-gate's MATRIX and not exported, so they are not here; the other rules still apply to
 * every path, those included.
 */
export const REVIEWED_GLOBS = [...DEPENDENCY_PATHS, PACKAGE_MANIFESTS, ...RICHTEXT_PATHS];

/** Longest segment and path, in UTF-8 bytes, that macOS, Linux and Windows can all check out. */
export const MAX_SEGMENT_BYTES = 255;
export const MAX_PATH_BYTES = 4096;

// Every pattern below is a single character class or a fixed suffix test, so each runs in
// linear time on any input (no nested or adjacent quantifiers).
const TRAILING_DOT_OR_SPACE = /[. ]$/;
// Default_Ignorable_Code_Point covers U+00AD, U+034F, U+115F/U+1160, U+180B–U+180F,
// U+200B–U+200F, U+202A–U+202E, U+2060–U+206F, U+3164, U+FE00–U+FE0F, U+FEFF, U+FFA0 and
// U+E0000–U+E0FFF: every code point HFS+ ignores in a name, and more (fail closed).
const IGNORABLE = /\p{Default_Ignorable_Code_Point}/u;
const CONTROL = /\p{Cc}/u;
const utf8Bytes = (s) => Buffer.byteLength(s, 'utf8');
const hex = (s) =>
  [...s].map((c) => `U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`);

/**
 * Every directory prefix of each path, plus the paths themselves, deduplicated. Callers pass
 * only paths of at most MAX_PATH_BYTES, which bounds the prefixes of one path to a few MB.
 */
export function entriesOf(paths) {
  const out = new Set();
  for (const p of paths) {
    let at = p.indexOf('/');
    while (at !== -1) {
      out.add(p.slice(0, at));
      at = p.indexOf('/', at + 1);
    }
    out.add(p);
  }
  return [...out];
}

/** Problems with one entry's own name (its last segment). */
function nameProblems(entry) {
  const name = entry.slice(entry.lastIndexOf('/') + 1);
  const found = [];
  const add = (rule, message) => found.push({ path: entry, rule, message });
  if (name.includes('\uFFFD'))
    add(
      'invalid-utf8',
      'the name is not valid UTF-8 (or contains U+FFFD). Rename it to plain UTF-8 text.',
    );
  if (utf8Bytes(name) > MAX_SEGMENT_BYTES)
    add(
      'too-long',
      `a path segment is ${utf8Bytes(name)} bytes; the limit is ${MAX_SEGMENT_BYTES}. Shorten it.`,
    );
  if (name === '' || TRAILING_DOT_OR_SPACE.test(name))
    add(
      'trailing-dot-space',
      'the segment is empty or ends in "." or a space, which Windows drops, so it opens another path. Remove the trailing character.',
    );
  if (name !== name.normalize('NFC'))
    add(
      'not-nfc',
      'the name is not NFC-normalised, and macOS treats its NFC and NFD spellings as one name. Rename it to its NFC form.',
    );
  const ignorable = [...name].filter((c) => IGNORABLE.test(c));
  if (ignorable.length)
    add(
      'ignorable',
      `the name contains ${[...new Set(hex(ignorable.join('')))].join(', ')}, which macOS ignores in file names, so it opens the name without them. Remove them.`,
    );
  const control = [...name].filter((c) => CONTROL.test(c));
  if (control.length)
    add(
      'control',
      `the name contains the control character(s) ${[...new Set(hex(control.join('')))].join(', ')}. Remove them.`,
    );
  return found;
}

/** Expands every `{a,b}` group: `package.{yaml,json5}` → `package.yaml`, `package.json5`. */
export function expandBraces(glob) {
  const m = /\{([^{}]*)\}/.exec(glob);
  if (!m) return [glob];
  return m[1]
    .split(',')
    .flatMap((alt) =>
      expandBraces(glob.slice(0, m.index) + alt + glob.slice(m.index + m[0].length)),
    );
}

/**
 * A glob as segment matchers. `**` is supported only as the last segment, which is all that
 * REVIEWED_GLOBS uses; anything else throws, so a new glob shape cannot be skipped silently.
 */
export function compileGlob(glob) {
  return expandBraces(glob.replace(/^\.?\//, '')).map((g) => {
    const segs = g.split('/');
    const rest = segs.at(-1) === '**';
    const fixed = rest ? segs.slice(0, -1) : segs;
    if (fixed.some((s) => s.includes('**')))
      throw new Error(
        `check-path-aliases: glob "${glob}" uses "**" before its last segment, which this check does not support. Extend compileGlob in scripts/check-path-aliases.mjs.`,
      );
    return {
      glob,
      rest,
      segs: fixed.map((s) =>
        /[*?]/.test(s)
          ? { re: globToRegExp(s, { nocase: true }) }
          : { literal: s, folded: foldCase(s) },
      ),
    };
  });
}

/**
 * The reviewed glob that `path` matches without regard to case while spelling one of the glob's
 * literal segments in another case, or null. Wildcard segments are not policed: in
 * `packages/*\/package.json` the package folder may have any case, `Package.json` may not.
 */
export function caseAliasOf(path, compiled) {
  const segs = path.split('/');
  for (const c of compiled) {
    if (c.rest ? segs.length <= c.segs.length : segs.length !== c.segs.length) continue;
    let differs = false;
    const all = c.segs.every((s, i) => {
      const p = segs[i];
      if (s.re) return s.re.test(foldCase(p));
      if (foldCase(p.normalize('NFC')) !== s.folded) return false;
      if (p !== s.literal) differs = true;
      return true;
    });
    if (all && differs) return c.glob;
  }
  return null;
}

/**
 * @param {string[]} paths tracked file paths (repo-relative, `/`-separated)
 * @param {string[]} [globs] reviewed globs (defaults to REVIEWED_GLOBS)
 * @returns {{ path: string, rule: string, message: string }[]}
 */
export function checkPaths(paths, globs = REVIEWED_GLOBS) {
  const problems = [];
  // A path over the limit is refused and not looked at further, which also keeps the work
  // below linear in the size of the listing.
  const sized = [];
  for (const p of paths)
    if (utf8Bytes(p) <= MAX_PATH_BYTES) sized.push(p);
    else
      problems.push({
        path: p.slice(0, 80) + '…',
        rule: 'too-long',
        message: `the path is ${utf8Bytes(p)} bytes; the limit is ${MAX_PATH_BYTES}. Shorten it.`,
      });
  paths = sized;
  const entries = entriesOf(paths);
  for (const e of entries) problems.push(...nameProblems(e));

  // Two entries (files or folders) that are one name on a case-insensitive filesystem.
  const byKey = new Map();
  for (const e of entries) {
    const k = foldCase(e.normalize('NFC'));
    const list = byKey.get(k);
    if (list) list.push(e);
    else byKey.set(k, [e]);
  }
  for (const group of byKey.values())
    if (group.length > 1)
      for (const e of group)
        problems.push({
          path: e,
          rule: 'case-collision',
          message: `on macOS and Windows it is the same path as ${group
            .filter((x) => x !== e)
            .map((x) => JSON.stringify(x))
            .join(', ')}. Keep one spelling.`,
        });

  // A path that spells a reviewed path in another case.
  const compiled = globs.flatMap(compileGlob);
  for (const p of paths) {
    const g = caseAliasOf(p, compiled);
    if (g)
      problems.push({
        path: p,
        rule: 'case-alias',
        message: `it spells the reviewed path "${g}" (scripts/review-gate.mjs) in another case, which macOS and Windows open as that path. Use the exact spelling.`,
      });
  }
  return problems;
}

/** Splits NUL-separated raw bytes into strings; invalid UTF-8 becomes U+FFFD (then refused). */
export function splitNul(buf) {
  const out = [];
  let start = 0;
  for (let i = 0; i < buf.length; i++)
    if (buf[i] === 0) {
      if (i > start) out.push(buf.subarray(start, i).toString('utf8'));
      start = i + 1;
    }
  if (start < buf.length) out.push(buf.subarray(start).toString('utf8'));
  return out;
}

/** Tracked paths of the git work tree at `cwd`, exactly as stored (no quoting, raw bytes). */
export function gitPaths(cwd = process.cwd()) {
  const r = spawnSync('git', ['-c', 'core.quotePath=false', 'ls-files', '-z'], {
    cwd,
    maxBuffer: 256 * 1024 * 1024,
  });
  if (r.status !== 0)
    throw new Error(`git ls-files failed: ${r.stderr?.toString().trim() || r.error?.message}`);
  return splitNul(r.stdout);
}

/**
 * Every path in a commit's tree, from the GitHub trees API. Fails closed when the API says the
 * listing is truncated, because a missing path would go unchecked.
 * @param {(path: string) => Promise<any>} api
 */
export async function treePaths(repo, sha, api) {
  if (!/^[0-9a-f]{40}$/i.test(sha ?? '')) throw new Error(`not a commit sha: "${sha}"`);
  const tree = await api(`repos/${repo}/git/trees/${sha}?recursive=1`);
  if (!Array.isArray(tree?.tree)) throw new Error('trees API: no "tree" list in the response');
  if (tree.truncated !== false)
    throw new Error(
      'trees API: the listing is truncated, so some paths could not be checked. Fix the check to page through subtrees.',
    );
  return tree.tree.map((t) => t.path).filter((p) => typeof p === 'string');
}

/** GET from the GitHub API. GITHUB_API_URL is set by the Actions runner (and by the tests). */
export async function githubApi(path) {
  const base = (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, '');
  const res = await fetch(`${base}/${path}`, {
    headers: {
      authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      accept: 'application/vnd.github+json',
    },
  });
  if (!res.ok) throw new Error(`GitHub API ${path}: ${res.status}`);
  return res.json();
}

/** Prints problems (at most `limit`) and returns the exit code. */
export function report(problems, limit = 100) {
  if (!problems.length) {
    console.log('check-path-aliases: OK');
    return 0;
  }
  console.error(`check-path-aliases: ${problems.length} path problem(s)\n`);
  for (const p of problems.slice(0, limit))
    console.error(`  ✗ ${JSON.stringify(p.path)} [${p.rule}]\n    ${p.message}\n`);
  if (problems.length > limit) console.error(`  … and ${problems.length - limit} more`);
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const i = process.argv.indexOf('--tree');
  let paths;
  try {
    if (i === -1) paths = gitPaths();
    else {
      const repo = process.env.GITHUB_REPOSITORY;
      if (!repo) throw new Error('GITHUB_REPOSITORY is not set (needed with --tree)');
      paths = await treePaths(repo, process.argv[i + 1], githubApi);
    }
  } catch (e) {
    console.error(`check-path-aliases: ${e.message}`);
    process.exit(1);
  }
  process.exit(report(checkPaths(paths)));
}
