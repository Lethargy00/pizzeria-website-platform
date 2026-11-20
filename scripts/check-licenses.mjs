#!/usr/bin/env node
// License check (Q9.3): every installed dependency must allow commercial, proprietary use.
// Reads `pnpm licenses list --json --prod=false` from stdin.
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';

export const ALLOWED = new Set([
  'MIT',
  'MIT-0',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'Apache-2.0',
  'BlueOak-1.0.0',
  'CC0-1.0',
  'CC-BY-4.0',
  'Unlicense',
  'Python-2.0',
  'OFL-1.1',
  'Zlib',
  'WTFPL',
]);

/** Accepts SPDX expressions: "A OR B" passes if any side passes; "A AND B" only if all pass. */
export function isAllowed(expr) {
  const e = String(expr).replace(/[()]/g, '').trim();
  if (/\sOR\s/i.test(e)) return e.split(/\s+OR\s+/i).some(isAllowed);
  if (/\sAND\s/i.test(e)) return e.split(/\s+AND\s+/i).every(isAllowed);
  return ALLOWED.has(e);
}

export function check(json) {
  const bad = [];
  for (const [license, pkgs] of Object.entries(json)) {
    if (isAllowed(license)) continue;
    for (const p of pkgs)
      bad.push(`${p.name}@${[p.versions ?? p.version].flat().join(',')}: ${license}`);
  }
  return bad;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const bad = check(JSON.parse(readFileSync(0, 'utf8')));
  if (bad.length) {
    console.error(`check-licenses: ${bad.length} package(s) with a license not on the allow-list:`);
    for (const b of bad) console.error(`  ✗ ${b}`);
    console.error(
      'Add a license to the allow-list only with a type:dependency issue approved by security.',
    );
    process.exit(1);
  }
  console.log('check-licenses: OK');
}
