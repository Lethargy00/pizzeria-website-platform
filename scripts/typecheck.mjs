#!/usr/bin/env node
// Type-checks the root config and every workspace package with the root TypeScript.
import { readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const projects = ['tsconfig.json', 'playground/tsconfig.json',
  ...readdirSync('packages').map((p) => `packages/${p}/tsconfig.json`)].filter(existsSync);
let failed = 0;
for (const p of projects) {
  const r = spawnSync('tsc', ['-p', p], { stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) { failed++; console.error(`✗ ${p}`); }
}
if (failed) process.exit(1);
console.log(`typecheck: OK (${projects.length} projects)`);
