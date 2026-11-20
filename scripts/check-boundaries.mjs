#!/usr/bin/env node
// Package dependency rules (ADR 0001). Fails on imports of @pwp/* packages that a
// package may not use, on relative imports that leave the package, and on any
// import of tenants/ from code.
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { walk } from './lib/fs-walk.mjs';

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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rules = JSON.parse(readFileSync(new URL('./boundaries.json', import.meta.url), 'utf8'));
  const problems = checkBoundaries(process.cwd(), rules);
  if (problems.length) {
    console.error(`check-boundaries: ${problems.length} violation(s)\n`);
    for (const p of problems) console.error(`  ✗ ${p.at}\n    ${p.message}\n`);
    process.exit(1);
  }
  console.log('check-boundaries: OK');
}
