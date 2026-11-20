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

// Content rules for YAML/Markdown. Tenants refer to platform components by name only.
export const CONTENT_RULES = [
  {
    id: 'html-script',
    re: /<\s*script\b/i,
    msg: 'HTML <script> tags are not allowed in tenant content.',
  },
  {
    id: 'html-embed',
    re: /<\s*(iframe|object|embed|link|style|meta|base|form)\b/i,
    msg: 'Raw HTML embeds are not allowed. Use a platform section type instead.',
  },
  {
    id: 'event-handler',
    re: /\son[a-z]+\s*=\s*["']/i,
    msg: 'Inline event handlers (onclick=…) are not allowed.',
  },
  {
    id: 'js-url',
    re: /\b(javascript|vbscript|data)\s*:/i,
    msg: 'javascript:, vbscript: and data: URLs are not allowed. Allowed schemes: https:, mailto:, tel:.',
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
    const name = e.path.split('/').pop();
    const at = `tenants/${e.path}`;
    if (e.isSymlink) {
      problems.push({
        path: at,
        rule: 'symlink',
        message: 'Symlinks are not allowed in tenants/ (they can escape tenant isolation).',
      });
      continue;
    }
    if (FORBIDDEN_NAMES.some((re) => re.test(name))) {
      problems.push({
        path: at,
        rule: 'forbidden-file',
        message: `"${name}" is not allowed. Tenants have no dependencies, package files or build steps; the platform provides everything.`,
      });
      continue;
    }
    if (
      ASSETS_PATH.test(e.path) &&
      !ALLOWED_NAMES.has(name) &&
      (!ASSET_SEGMENT.test(name) || name.includes('..'))
    ) {
      problems.push({
        path: at,
        rule: 'asset-name',
        message: `"${name}" is not a valid asset name. Names under assets/ must be lowercase letters, digits, "-", "_" or "." and start with a letter or digit (no spaces, uppercase or non-ASCII), or no AssetRef can point to it. Rename it, e.g. "${suggest(name)}".`,
      });
      continue;
    }
    if (e.isDir) continue;
    if (!ALLOWED_NAMES.has(name) && !ALLOWED_EXT.has(ext(name))) {
      problems.push({
        path: at,
        rule: 'file-type',
        message: `File type "${ext(name) || name}" is not allowed. Allowed: ${[...ALLOWED_EXT].join(' ')}.`,
      });
      continue;
    }
    if (TEXT_EXT.has(ext(name))) {
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
      for (const rule of CONTENT_RULES) {
        const m = rule.re.exec(text);
        if (m) {
          const line = text.slice(0, m.index).split('\n').length;
          problems.push({
            path: `${at}:${line}`,
            rule: rule.id,
            message: `${rule.msg} Found: ${JSON.stringify((lines[line - 1] ?? '').trim().slice(0, 80))}`,
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
    for (const p of problems) console.error(`  ✗ ${p.path}  [${p.rule}]\n    ${p.message}\n`);
    process.exit(1);
  }
  console.log('tenant-guard: OK');
}
