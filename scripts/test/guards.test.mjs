import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { globToRegExp, matchesAny } from '../lib/glob.mjs';
import { checkTenants, safe } from '../tenant-guard.mjs';
import { checkBoundaries, findImports } from '../check-boundaries.mjs';
import { evaluate } from '../review-gate.mjs';
import { closedIssue, parseTouches, outside } from '../touches-guard.mjs';
import { isAllowed, check } from '../check-licenses.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'pwp-'));
const put = (root, rel, text = '') => {
  mkdirSync(join(root, rel, '..'), { recursive: true });
  writeFileSync(join(root, rel), text);
};

test('glob matching', () => {
  assert.ok(
    globToRegExp('packages/ui/src/components/Hero/**').test(
      'packages/ui/src/components/Hero/variants/split.astro',
    ),
  );
  assert.ok(
    globToRegExp('packages/ui/src/components/Hero/**').test(
      'packages/ui/src/components/Hero/Hero.astro',
    ),
  );
  assert.ok(
    !globToRegExp('packages/ui/src/components/Hero/**').test(
      'packages/ui/src/components/HeroX/a.ts',
    ),
  );
  assert.ok(globToRegExp('packages/*/package.json').test('packages/ui/package.json'));
  assert.ok(!globToRegExp('packages/*/package.json').test('packages/ui/sub/package.json'));
  assert.ok(globToRegExp('**/.env.example').test('.env.example'));
  assert.ok(globToRegExp('**/.env.example').test('packages/adapters/email/.env.example'));
  assert.ok(globToRegExp('docs/{SETUP,HANDOFF}.md').test('docs/HANDOFF.md'));
  assert.ok(matchesAny('docs/adr/0001.md', ['docs/']));
});

test('tenant-guard: clean tenant passes', () => {
  const r = tmp();
  put(
    r,
    'demo/site.config.yaml',
    'theme: modern-minimal\nlinks:\n  order: https://example.com/order\n  phone: tel:+46812345678\n',
  );
  put(
    r,
    'demo/content/pages/about.md',
    '# Om oss\n\nVi bakar sedan 1998. [Mejla oss](mailto:hej@example.com)\n',
  );
  put(r, 'demo/assets/logo.webp', 'x');
  put(r, 'demo/assets/fonts/brand.woff2', 'x');
  assert.deepEqual(checkTenants(r), []);
});

test('tenant-guard: forbidden files, types, symlinks', () => {
  const r = tmp();
  for (const f of ['package.json', 'pnpm-lock.yaml', '.npmrc', 'yarn.lock', 'importmap.json'])
    put(r, `a/${f}`, '{}');
  mkdirSync(join(r, 'a/node_modules'), { recursive: true });
  put(r, 'a/custom.js', 'alert(1)');
  put(r, 'a/assets/logo.svg', '<svg/>');
  put(r, 'a/assets/font.ttf', 'x');
  symlinkSync('../../b', join(r, 'a/peek'));
  const rules = checkTenants(r).map((p) => `${p.rule} ${p.path}`);
  for (const f of [
    'package.json',
    'pnpm-lock.yaml',
    '.npmrc',
    'yarn.lock',
    'importmap.json',
    'node_modules',
  ])
    assert.ok(rules.includes(`forbidden-file tenants/a/${f}`), f);
  assert.ok(rules.includes('file-type tenants/a/custom.js'));
  assert.ok(rules.includes('file-type tenants/a/assets/logo.svg'));
  assert.ok(rules.includes('file-type tenants/a/assets/font.ttf'));
  assert.ok(rules.includes('symlink tenants/a/peek'));
});

test('tenant-guard: asset names must match AssetRef segments', () => {
  const r = tmp();
  for (const f of [
    'a/assets/Hero.JPG',
    'a/assets/Hero.jpg',
    'a/assets/hero image.jpg',
    'a/assets/bröd.jpg',
    'a/assets/日本.png',
    'a/assets/fonts/Brand.woff2',
    'a/assets/-x.png',
    'a/assets/_x.png',
    'a/assets/.hidden.png',
    'a/assets/a..b.png',
    'a/assets/Fonts/ok.woff2',
  ])
    put(r, f, 'x');
  const bad = checkTenants(r)
    .filter((p) => p.rule === 'asset-name')
    .map((p) => p.path);
  for (const f of [
    'Hero.JPG',
    'Hero.jpg',
    'hero image.jpg',
    'bröd.jpg',
    '日本.png',
    'fonts/Brand.woff2',
    '-x.png',
    '_x.png',
    '.hidden.png',
    'a..b.png',
    'Fonts',
  ])
    assert.ok(bad.includes(`tenants/a/assets/${f}`), f);
  assert.ok(!bad.includes('tenants/a/assets/Fonts/ok.woff2'));
  // Files outside assets/ are not subject to the rule.
  const r2 = tmp();
  put(r2, 'a/content/pages/About Us.md', '# x\n');
  assert.deepEqual(checkTenants(r2), []);
});

test('tenant-guard: only assets/ and content/ are allowed tenant-level folders', () => {
  const r = tmp();
  put(r, 'a/Assets/logo.png', 'x');
  put(r, 'a/CONTENT/pages/about.md', '# x\n');
  put(r, 'a/custom/x.md', '# x\n');
  put(r, 'a/site.config.yaml', 'theme: x\n');
  put(r, 'a/assets/logo.png', 'x');
  put(r, 'a/content/pages/about.md', '# x\n');
  put(r, 'a/content/Pages/Sub/About.md', '# x\n'); // deeper folders are not restricted here
  const bad = checkTenants(r)
    .filter((p) => p.rule === 'tenant-folder')
    .map((p) => p.path)
    .sort();
  assert.deepEqual(bad, ['tenants/a/Assets', 'tenants/a/CONTENT', 'tenants/a/custom']);
  const ok = tmp();
  put(ok, 'a/assets/logo.png', 'x');
  put(ok, 'a/content/menu.yaml', 'x: 1\n');
  assert.deepEqual(checkTenants(ok), []);
});

test('tenant-guard: control characters in names are escaped everywhere they are printed', () => {
  assert.equal(
    safe('a\nb\r\t\u001b\u007f\u0085\u2028"\\'),
    'a\\nb\\r\\t\\u001b\\u007f\\u0085\\u2028\\"\\\\',
  );
  const r = tmp();
  const evil = 'x\n::error::pwned.js';
  put(r, `a/${evil}`, 'x');
  put(r, `a/assets/bad\n::error::y.jpg`, 'x');
  put(r, `a/Evil\n::error::z/f.md`, '# x\n');
  const problems = checkTenants(r);
  assert.ok(problems.length >= 3);
  for (const p of problems) {
    for (const ch of p.path + p.message) {
      const c = ch.charCodeAt(0);
      const control = c < 0x20 || (c >= 0x7f && c <= 0x9f) || c === 0x2028 || c === 0x2029;
      assert.ok(!control, `control character U+${c.toString(16)} in ${JSON.stringify(p.path)}`);
    }
  }
  assert.ok(problems.some((p) => p.path === 'tenants/a/x\\n::error::pwned.js'));
  // End to end: no output line may start with a workflow command.
  const res = spawnSync(process.execPath, ['scripts/tenant-guard.mjs', r], { encoding: 'utf8' });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /x\\n::error::pwned\.js/);
  for (const line of res.stderr.split('\n')) assert.ok(!line.trimStart().startsWith('::'), line);
});

test('tenant-guard: valid asset names pass', () => {
  const r = tmp();
  put(r, 'a/assets/hero-1_x.v2.jpg', 'x');
  put(r, 'a/assets/gallery/pizza-01.webp', 'x');
  put(r, 'a/assets/fonts/display.woff2', 'x');
  put(r, 'a/assets/.gitkeep');
  put(r, 'a/assets/README.md', '# assets\n');
  assert.deepEqual(checkTenants(r), []);
});

test('tenant-guard: dangerous content in YAML/Markdown', () => {
  // Every rule must fire on its own example. More payloads (#132): tenant-guard-content.test.mjs.
  const cases = {
    'html-tag': '<b>fet</b>',
    'html-script': 'x: "<script>alert(1)</script>"',
    'html-embed': '<iframe src="https://evil.example"></iframe>',
    'event-handler': '<img src=x onerror=alert(1)>',
    'js-url': 'cta: javascript&#58;alert(1)',
    'insecure-url': 'link: http://example.com',
    'external-asset': 'style: https://cdn.example.com/x.css',
    'font-cdn': 'font: https://fonts.googleapis.com/css2?family=Inter',
    'module-import': "import x from 'y'",
  };
  for (const [rule, text] of Object.entries(cases)) {
    const r = tmp();
    put(r, 't/content/x.md', `ok line\n${text}\n`);
    const p = checkTenants(r);
    assert.ok(
      p.some((x) => x.rule === rule && x.path === 'tenants/t/content/x.md:2'),
      `${rule}: ${JSON.stringify(p)}`,
    );
  }
});

test('check-boundaries', () => {
  const r = tmp();
  const rules = { allow: { schema: [], ui: ['schema'], core: ['schema'] } };
  put(r, 'packages/schema/src/index.ts', "import { z } from 'zod';\nexport const a = 1;\n");
  put(
    r,
    'packages/ui/src/ok.ts',
    "import type { A } from '@pwp/schema/menu';\nimport { b } from './b.js';\n",
  );
  put(r, 'packages/ui/src/b.ts', 'export const b = 1;');
  assert.deepEqual(checkBoundaries(r, rules), []);
  put(
    r,
    'packages/ui/src/bad.ts',
    "import { x } from '@pwp/core';\nconst y = await import('../../core/src/index.js');\nimport m from '../../../tenants/demo/menu.yaml';\n",
  );
  const p = checkBoundaries(r, rules).map((x) => x.at + ' ' + x.message);
  assert.equal(p.length, 4, p.join('\n'));
  assert.ok(p[0].startsWith('packages/ui/src/bad.ts:1 @pwp/ui may not import @pwp/core'));
  assert.deepEqual(
    findImports("export { a } from './a.js'").map((i) => i.spec),
    ['./a.js'],
  );
});

test('review-gate matrix', () => {
  assert.deepEqual(
    evaluate(['docs/guides/x.md'], []).missing.map((m) => m.label),
    ['approved:peer'],
  );
  assert.deepEqual(evaluate(['docs/guides/x.md'], ['approved:peer']).missing, []);
  const ui = evaluate(['packages/ui/src/components/Hero/Hero.astro'], ['approved:peer']);
  assert.deepEqual(
    ui.missing.map((m) => m.label),
    ['approved:a11y-perf'],
  );
  const dep = evaluate(['pnpm-lock.yaml'], ['approved:peer'])
    .missing.map((m) => m.label)
    .sort();
  assert.deepEqual(dep, ['approved:architect', 'approved:security']);
  const wf = evaluate(['.github/workflows/ci.yml'], ['approved:peer']).missing.map((m) => m.label);
  assert.deepEqual(wf, ['approved:security']);
  const fn = evaluate(
    ['packages/functions/src/contact/handler.ts'],
    ['approved:peer', 'approved:security'],
  );
  assert.deepEqual(fn.missing, []);
  assert.deepEqual(
    evaluate(['README.md'], ['approved:peer', 'security:sensitive']).missing.map((m) => m.label),
    ['approved:security'],
  );
  assert.equal(evaluate(['README.md'], ['approved:peer', 'security:blocking']).blocking, true);
});

test('touches-guard parsing', () => {
  assert.equal(closedIssue('**[agent: ui-1]**\n\nCloses #42\n'), 42);
  assert.equal(closedIssue('fixes #7'), 7);
  assert.equal(closedIssue('relates to #7'), null);
  const md =
    '## Scope\nIn: x\n## Touches\n- `packages/ui/src/components/Hero/**`, `docs/guides/hero.md`\n## Contracts\n`packages/schema/**`\n';
  assert.deepEqual(parseTouches(md), ['packages/ui/src/components/Hero/**', 'docs/guides/hero.md']);
  const form =
    '### Scope\n\nIn\n\n### Touches\n\n- `packages/core/**`\n\n### Contracts\n\n_No response_';
  assert.deepEqual(parseTouches(form), ['packages/core/**']);
  assert.deepEqual(parseTouches('## Touches\n- `a/**`'), ['a/**']);
  assert.deepEqual(outside(['packages/core/src/a.ts', 'pnpm-lock.yaml'], ['packages/core/**']), [
    'pnpm-lock.yaml',
  ]);
});

test('license allow-list', () => {
  assert.ok(isAllowed('MIT'));
  assert.ok(isAllowed('(MIT OR GPL-3.0)'));
  assert.ok(!isAllowed('MIT AND GPL-3.0'));
  assert.ok(!isAllowed('AGPL-3.0'));
  assert.deepEqual(
    check({
      MIT: [{ name: 'a', versions: ['1.0.0'] }],
      'GPL-3.0': [{ name: 'b', versions: ['2.0.0'] }],
    }),
    ['b@2.0.0: GPL-3.0'],
  );
});
