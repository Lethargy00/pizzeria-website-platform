#!/usr/bin/env node
// Package dependency rules (ADR 0001). Fails on imports of @pwp/* packages that a
// package may not use, on relative imports that leave the package, and on any
// import of tenants/ from code. checkDeclaredImports (#240) fails on bare imports of
// packages that the importing workspace package does not declare in its package.json.
import { pathToFileURL } from 'node:url';
import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { join, dirname, resolve, relative } from 'node:path';
import { walk } from './lib/fs-walk.mjs';

const CODE_EXT = /\.([mc]?[jt]sx?|astro)$/;
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

// ---------------------------------------------------------------------------------------------
// Undeclared (phantom) dependencies (#240). Node's resolver walks up to the root node_modules,
// so without this check any package could load a root devDependency it never declared.

/** Manifest fields that count as declaring a dependency. */
export const DECLARING_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies'];

/**
 * Known undeclared imports on main. Each entry suppresses exactly one {package, dependency}
 * pair and names the open type:dependency issue that removes it. An entry that no longer
 * matches an undeclared import fails the check, so this list can only shrink.
 */
export const UNDECLARED_ALLOW = [
  { package: '@pwp/schema', dependency: 'vitest', issue: '#241' },
  { package: '@pwp/core', dependency: 'vitest', issue: '#241' },
  { package: '@pwp/adapters', dependency: 'vitest', issue: '#241' },
  { package: '@pwp/adapters', dependency: '@types/node', issue: '#241' },
];

/** Virtual-module schemes and the package that provides them (allowed only when declared). */
export const SCHEME_PACKAGES = { astro: 'astro' };

const ISSUE_REF = /^#[1-9]\d*$/;
// `x.import(` is an ordinary method; `module.require(` loads modules like require( does.
const DYNAMIC_RE = /(?:(?<![\w$.])(import)|(?<![\w$])(require))\s*\(\s*/g;
// Ways to load a module that no specifier scan can follow. Code under packages/ has no use
// for them; a package that needs one should get its own reviewed exception here.
const OPAQUE_LOADER_RE = /(?<![\w$])(createRequire|Module\._load|process\.mainModule)(?![\w$])/g;
const LITERAL_ARG_RE = /^(?:'[^'\\\n]*'|"[^"\\\n]*")\s*[,)]/;
const REFERENCE_TYPES_RE = /^[ \t]*\/\/\/[ \t]*<reference\s+types\s*=\s*['"]([^'"]*)['"]/gm;
const SCHEME_RE = /^([a-zA-Z][a-zA-Z\d+.-]*):/;
const SEGMENT = /^[a-z0-9~][a-z0-9._~-]*$/i;
const lineOf = (source, index) => source.slice(0, index).split('\n').length;

/**
 * `import(x)` and `require(x)` calls whose whole first argument is not one '…' or "…" literal.
 * `import('./x' + y)` counts as non-literal: the literal prefix does not say what is loaded.
 */
export function findDynamicImports(source) {
  const out = [];
  for (const m of source.matchAll(DYNAMIC_RE)) {
    const rest = source.slice(m.index + m[0].length);
    if (!LITERAL_ARG_RE.test(rest))
      out.push({ kind: `${m[1] ?? m[2]}()`, line: lineOf(source, m.index) });
  }
  for (const m of source.matchAll(OPAQUE_LOADER_RE))
    out.push({ kind: m[1], line: lineOf(source, m.index) });
  return out.sort((a, b) => a.line - b.line);
}

/** `/// <reference types="x" />` directives. */
export function findReferenceTypes(source) {
  return [...source.matchAll(REFERENCE_TYPES_RE)].map((m) => ({
    spec: m[1],
    line: lineOf(source, m.index),
  }));
}

/**
 * What an import specifier loads.
 * - relative: a file in this package (the ADR 0001 check decides whether it leaves the package)
 * - builtin: a Node builtin (`node:x`, or a bare name Node itself treats as builtin)
 * - package: the npm package `name` (`@scope/name` or `name`, subpath dropped)
 * - invalid: anything check-boundaries cannot map to a declared package; `reason` says why
 * @returns {{kind:'relative'|'builtin'|'package'|'invalid', name?:string, reason?:string}}
 */
export function classifySpecifier(spec) {
  if (spec === '.' || spec === '..' || spec.startsWith('./') || spec.startsWith('../'))
    return { kind: 'relative' };
  const scheme = SCHEME_RE.exec(spec)?.[1];
  if (scheme === 'node')
    return isBuiltin(spec)
      ? { kind: 'builtin' }
      : { kind: 'invalid', reason: `"${spec}" is not a Node builtin module.` };
  if (scheme && Object.hasOwn(SCHEME_PACKAGES, scheme))
    return { kind: 'package', name: SCHEME_PACKAGES[scheme] };
  if (scheme)
    return {
      kind: 'invalid',
      reason: `"${spec}" is a URL or unknown-scheme import. Packages may import only their own files, Node builtins and declared dependencies.`,
    };
  if (spec.startsWith('/') || spec.startsWith('\\'))
    return {
      kind: 'invalid',
      reason: `"${spec}" is an absolute path. Use a relative path inside the package, or a declared dependency.`,
    };
  if (spec.startsWith('#'))
    return {
      kind: 'invalid',
      reason: `"${spec}" is a package.json "imports" alias, which check-boundaries cannot resolve. Use a relative path, or a declared dependency.`,
    };
  // Bare names that are builtins only with the node: prefix (test, sqlite, …) are npm packages.
  if (isBuiltin(spec)) return { kind: 'builtin' };
  const parts = spec.split('/');
  const scoped = spec.startsWith('@');
  const name = scoped ? parts.slice(0, 2).join('/') : parts[0];
  const valid = scoped
    ? parts.length >= 2 && SEGMENT.test(parts[0].slice(1)) && SEGMENT.test(parts[1])
    : SEGMENT.test(parts[0]);
  if (!valid) return { kind: 'invalid', reason: `"${spec}" is not a valid package specifier.` };
  return { kind: 'package', name };
}

/** Packages `/// <reference types="x" />` can load: x itself or its DefinitelyTyped package. */
function referenceTypePackages(name) {
  return name.startsWith('@types/')
    ? [name]
    : [name, `@types/${name.startsWith('@') ? name.slice(1).replace('/', '__') : name}`];
}

/** Workspace package folders: every folder in packages/, plus playground/ when present. */
export function workspaceUnits(repoRoot) {
  const isDir = (p) => {
    try {
      return lstatSync(p).isDirectory();
    } catch {
      return false;
    }
  };
  let names = [];
  try {
    names = readdirSync(join(repoRoot, 'packages')).sort();
  } catch {
    names = [];
  }
  const units = names
    .filter((n) => isDir(join(repoRoot, 'packages', n)))
    .map((n) => `packages/${n}`);
  if (isDir(join(repoRoot, 'playground'))) units.push('playground');
  return units;
}

/** Reads a unit's manifest. Throws with a message that names the file. */
function readManifest(repoRoot, manifestPath) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(repoRoot, manifestPath), 'utf8'));
  } catch (err) {
    throw new Error(`cannot read it (${err.code ?? err.message})`);
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest))
    throw new Error('it is not a JSON object');
  if (typeof manifest.name !== 'string' || !manifest.name) throw new Error('"name" is missing');
  for (const f of DECLARING_FIELDS) {
    const v = manifest[f];
    if (v !== undefined && (!v || typeof v !== 'object' || Array.isArray(v)))
      throw new Error(`"${f}" is not an object`);
  }
  return manifest;
}

/**
 * Fails on imports of packages the importing workspace package does not declare: static,
 * side-effect, type-only, re-exports, literal import()/require(), and `/// <reference types>`.
 * Also fails on import()/require() whose argument is not a string literal, and on specifiers
 * that cannot be mapped to a package (unknown schemes, absolute paths, "#" aliases).
 * @param {string} repoRoot
 * @param {{ allow?: {package:string, dependency:string, issue:string}[], units?: string[] }} [opts]
 * @returns {{ at: string, message: string }[]}
 */
export function checkDeclaredImports(repoRoot, opts = {}) {
  const allow = opts.allow ?? UNDECLARED_ALLOW;
  const units = opts.units ?? workspaceUnits(repoRoot);
  const problems = [];
  const allowAt = (i) => `scripts/check-boundaries.mjs UNDECLARED_ALLOW[${i}]`;
  const allowed = new Map();
  allow.forEach((a, i) => {
    const ok =
      a &&
      typeof a.package === 'string' &&
      typeof a.dependency === 'string' &&
      typeof a.issue === 'string' &&
      ISSUE_REF.test(a.issue);
    const key = ok && `${a.package}\0${a.dependency}`;
    if (!ok)
      problems.push({
        at: allowAt(i),
        message: `Allow-list entry ${JSON.stringify(a)} needs string fields package, dependency and issue ("#<number>" of the type:dependency issue that removes it).`,
      });
    else if (allowed.has(key))
      problems.push({
        at: allowAt(i),
        message: `Duplicate allow-list entry for ${a.package} and "${a.dependency}". Keep one.`,
      });
    else allowed.set(key, i);
  });
  const used = new Set();

  for (const dir of units) {
    const manifestPath = `${dir}/package.json`;
    let manifest;
    try {
      manifest = readManifest(repoRoot, manifestPath);
    } catch (err) {
      problems.push({
        at: manifestPath,
        message: `${manifestPath}: ${err.message}. Every workspace package needs a package.json with a "name" so its imports can be checked against what it declares.`,
      });
      continue;
    }
    const self = manifest.name;
    const declared = new Set(DECLARING_FIELDS.flatMap((f) => Object.keys(manifest[f] ?? {})));
    const check = (at, what, names) => {
      if (names.some((n) => n === self || declared.has(n))) return;
      for (const n of names) {
        const i = allowed.get(`${self}\0${n}`);
        if (i !== undefined) return void used.add(i);
      }
      problems.push({
        at,
        message: `${what} loads ${names.map((n) => `"${n}"`).join(' or ')}, which ${self} does not declare in ${manifestPath} (${DECLARING_FIELDS.join(', ')}). Declare it through an approved type:dependency issue, or remove the import.`,
      });
    };
    for (const e of walk(join(repoRoot, dir), repoRoot)) {
      if (
        e.isDir ||
        !CODE_EXT.test(e.path) ||
        e.path.includes('/node_modules/') ||
        e.path.includes('/dist/')
      )
        continue;
      const source = readFileSync(e.full, 'utf8');
      for (const { spec, line } of findImports(source)) {
        const c = classifySpecifier(spec);
        if (c.kind === 'invalid') problems.push({ at: `${e.path}:${line}`, message: c.reason });
        else if (c.kind === 'package') check(`${e.path}:${line}`, `"${spec}"`, [c.name]);
      }
      for (const { spec, line } of findReferenceTypes(source)) {
        const c = classifySpecifier(spec);
        if (c.kind === 'package')
          check(
            `${e.path}:${line}`,
            `/// <reference types="${spec}" />`,
            referenceTypePackages(c.name),
          );
        else
          problems.push({
            at: `${e.path}:${line}`,
            message: `/// <reference types="${spec}" /> must name a package.`,
          });
      }
      for (const { kind, line } of findDynamicImports(source))
        problems.push({
          at: `${e.path}:${line}`,
          message: kind.endsWith('()')
            ? `${kind} with a non-literal argument cannot be checked. Use a '…' or "…" string literal so check-boundaries can verify that the target is declared.`
            : `${kind} loads modules in a way check-boundaries cannot follow. Use a static import or import('…') of a declared dependency.`,
        });
    }
  }
  for (const i of allowed.values())
    if (!used.has(i)) {
      const a = allow[i];
      problems.push({
        at: allowAt(i),
        message: `Stale allow-list entry: ${a.package} no longer imports "${a.dependency}" without declaring it (${a.issue}). Remove the entry.`,
      });
    }
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rules = JSON.parse(readFileSync(new URL('./boundaries.json', import.meta.url), 'utf8'));
  const problems = [
    ...checkBoundaries(process.cwd(), rules),
    ...checkDeclaredImports(process.cwd()),
  ];
  if (problems.length) {
    console.error(`check-boundaries: ${problems.length} violation(s)\n`);
    for (const p of problems) console.error(`  ✗ ${p.at}\n    ${p.message}\n`);
    process.exit(1);
  }
  console.log('check-boundaries: OK');
}
