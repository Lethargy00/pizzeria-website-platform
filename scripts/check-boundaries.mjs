#!/usr/bin/env node
// Package dependency rules (ADR 0001). Fails on imports of @pwp/* packages that a
// package may not use, on relative imports that leave the package, and on any
// import of tenants/ from code.
// Rich-text chokepoint (ADR 0002 Enforcement (a) and (f), #79): Markdown and sanitizer
// imports, astro:content, <Content /> and Markdown imports only in the richtext folder, and
// the banned tokens from boundaries.json nowhere in the repo. The tokens are read from the
// config, so this file never names them.
import { pathToFileURL } from 'node:url';
import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { walk } from './lib/fs-walk.mjs';
import { globToRegExp, matchesAny } from './lib/glob.mjs';

const CODE_EXT = /\.(m?[jt]sx?|cjs|astro)$/;
const IMPORT_RE =
  /(?:\bimport\s+(?:type\s+)?(?:[^'"`;]*?\sfrom\s*)?|\bexport\s+[^'"`;]*?\sfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/g;

export function findImports(source) {
  const out = [];
  for (const m of source.matchAll(IMPORT_RE))
    out.push({ spec: m[1], line: source.slice(0, m.index).split('\n').length });
  return out;
}

export function checkBoundaries(repoRoot, rules) {
  const problems = [];
  const units = Object.keys(rules.allow).map((n) => ({
    name: n,
    dir: n === 'playground' ? 'playground' : `packages/${n}`,
  }));
  for (const u of units) {
    const allowed = new Set(rules.allow[u.name].map((x) => `@pwp/${x}`));
    const unitRoot = resolve(repoRoot, u.dir);
    for (const e of walk(join(repoRoot, u.dir), repoRoot)) {
      if (
        e.isDir ||
        !CODE_EXT.test(e.path) ||
        e.path.includes('/node_modules/') ||
        e.path.includes('/dist/')
      )
        continue;
      for (const { spec, line } of findImports(readFileSync(e.full, 'utf8'))) {
        const at = `${e.path}:${line}`;
        if (spec.startsWith('@pwp/')) {
          const pkg = spec.split('/').slice(0, 2).join('/');
          if (pkg === `@pwp/${u.name}`) continue;
          if (!allowed.has(pkg))
            problems.push({
              at,
              message: `@pwp/${u.name} may not import ${pkg}. Allowed: ${[...allowed].join(', ') || 'none'} (ADR 0001).`,
            });
        } else if (spec.startsWith('.')) {
          const target = resolve(dirname(e.full), spec);
          const rel = relative(unitRoot, target);
          if (rel.startsWith('..'))
            problems.push({
              at,
              message: `Relative import "${spec}" leaves ${u.dir}. Import the package by name instead.`,
            });
        }
        if (/(^|\/)tenants\//.test(spec))
          problems.push({
            at,
            message: `Code may not import from tenants/ ("${spec}"). Tenant data is loaded by the CLI, per tenant, at build time.`,
          });
      }
    }
  }
  return problems;
}

/** Directories never scanned by the rich-text check: dependencies, git data and build output. */
export const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  '.turbo',
  '.astro',
  'coverage',
  'playwright-report',
  'test-results',
]);

/** Like walk(), but prunes SKIP_DIRS at any depth and never follows symlinks. Files only. */
function* walkFiles(root, base = root) {
  let entries;
  try {
    entries = readdirSync(root);
  } catch {
    return;
  }
  for (const name of entries) {
    const full = join(root, name);
    const st = lstatSync(full);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(name)) yield* walkFiles(full, base);
      continue;
    }
    yield { path: relative(base, full).split('\\').join('/'), full };
  }
}

/** npm package name of an import specifier: `@scope/name` or `name`, without a subpath. */
export function packageName(spec) {
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/** Fails closed: a missing or emptied rich-text section must not silently disable the check. */
export function assertRichtextRules(cfg) {
  const lists = ['allowedIn', 'scan', 'restrictedImports', 'bannedTokens', 'bannedTokenExceptions'];
  if (!cfg || typeof cfg !== 'object')
    throw new Error('boundaries.json: "richtext" section is missing.');
  for (const k of lists) {
    const v = cfg[k];
    const ok = Array.isArray(v) && v.every((x) => typeof x === 'string' && x.trim() !== '');
    if (!ok || (k !== 'bannedTokenExceptions' && v.length === 0))
      throw new Error(`boundaries.json: "richtext.${k}" must be a non-empty list of strings.`);
  }
}

const MARKDOWN_SPEC = /\.mdx?(?:\?.*)?$/i;
const JSX_EXT = /\.(astro|[jt]sx)$/;
const CONTENT_TAG = /<Content(?=[\s/>])/g;
const META_GLOB = /\bimport\.meta\.glob(?:Eager)?\s*(?:<[^>]*>)?\s*\(([^)]*)\)/g;
const MARKDOWN_GLOB = /\.mdx?\b|\{[^}]*\bmdx?\b[^}]*\}/i;
const lineAt = (text, index) => text.slice(0, index).split('\n').length;

/** ADR 0002 (a) and (f). Returns { at, rule, message } problems; at is `path:line`. */
export function checkRichtext(repoRoot, cfg) {
  assertRichtextRules(cfg);
  const where = cfg.allowedIn.join(', ');
  const restricted = cfg.restrictedImports.map((g) => globToRegExp(g));
  const tokens = cfg.bannedTokens.map((t) => t.toLowerCase());
  const problems = [];
  const add = (path, line, rule, message) =>
    problems.push({ at: `${path}:${line}`, rule, message });

  for (const f of walkFiles(resolve(repoRoot))) {
    const buf = readFileSync(f.full);
    if (buf.includes(0)) continue; // binary (images, fonts)
    const text = buf.toString('utf8');

    // (f) banned tokens, repo-wide, the richtext folder included.
    if (!matchesAny(f.path, cfg.bannedTokenExceptions)) {
      const lower = text.toLowerCase();
      tokens.forEach((t, i) => {
        const at = lower.indexOf(t);
        if (at !== -1)
          add(
            f.path,
            lineAt(text, at),
            'richtext-banned-token',
            `"${cfg.bannedTokens[i]}" is banned repo-wide (ADR 0002 (f)): it lets raw HTML through the Markdown pipeline. Remove it.`,
          );
      });
    }

    // (a) imports and Markdown rendering, in scanned code outside the richtext folder.
    if (
      !CODE_EXT.test(f.path) ||
      !matchesAny(f.path, cfg.scan) ||
      matchesAny(f.path, cfg.allowedIn)
    )
      continue;
    for (const { spec, line } of findImports(text)) {
      if (spec === 'astro:content')
        add(
          f.path,
          line,
          'richtext-astro-content',
          `astro:content may only be used in ${where} (ADR 0002 (a)): its render() turns Markdown into HTML without our sanitizer. Tenant content is loaded by the CLI and rendered with renderMarkdown from @pwp/core/richtext.`,
        );
      else if (MARKDOWN_SPEC.test(spec))
        add(
          f.path,
          line,
          'richtext-markdown-import',
          `Importing Markdown ("${spec}") renders it without our sanitizer (ADR 0002 (a)). Render it with renderMarkdown from @pwp/core/richtext.`,
        );
      else if (!spec.startsWith('.') && restricted.some((re) => re.test(packageName(spec))))
        add(
          f.path,
          line,
          'richtext-import',
          `"${spec}" may only be imported in ${where} (ADR 0002 (a)). Use renderMarkdown from @pwp/core/richtext instead.`,
        );
    }
    for (const m of text.matchAll(META_GLOB))
      if (MARKDOWN_GLOB.test(m[1]))
        add(
          f.path,
          lineAt(text, m.index),
          'richtext-markdown-import',
          `import.meta.glob of Markdown renders it without our sanitizer (ADR 0002 (a)). Render it with renderMarkdown from @pwp/core/richtext.`,
        );
    if (JSX_EXT.test(f.path))
      for (const m of text.matchAll(CONTENT_TAG))
        add(
          f.path,
          lineAt(text, m.index),
          'richtext-content-component',
          `<Content /> renders Markdown without our sanitizer (ADR 0002 (a)). Pass a SafeHtml value from renderMarkdown instead.`,
        );
  }
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rules = JSON.parse(readFileSync(new URL('./boundaries.json', import.meta.url), 'utf8'));
  let problems;
  try {
    problems = [
      ...checkBoundaries(process.cwd(), rules),
      ...checkRichtext(process.cwd(), rules.richtext),
    ];
  } catch (e) {
    console.error(`check-boundaries: ${e.message}`);
    process.exit(1);
  }
  if (problems.length) {
    console.error(`check-boundaries: ${problems.length} violation(s)\n`);
    for (const p of problems) console.error(`  ✗ ${p.at}\n    ${p.message}\n`);
    process.exit(1);
  }
  console.log('check-boundaries: OK');
}
