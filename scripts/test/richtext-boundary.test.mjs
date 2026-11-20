// ADR 0002 Enforcement (a) and (f), #79: every banned pattern has a failing and an allowed
// fixture. The fixtures run against the real rules in scripts/boundaries.json. The banned
// tokens are read from that config, so this file never names them (it is scanned too).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkRichtext, assertRichtextRules, packageName } from '../check-boundaries.mjs';

const RULES = JSON.parse(readFileSync(new URL('../boundaries.json', import.meta.url), 'utf8'));
const CFG = RULES.richtext;
const REPO = fileURLToPath(new URL('../..', import.meta.url));

const tmp = () => mkdtempSync(join(tmpdir(), 'pwp-rt-'));
const put = (root, rel, text = '') => {
  mkdirSync(join(root, rel, '..'), { recursive: true });
  writeFileSync(join(root, rel), text);
};
/** Problems for a repo that contains exactly these files. */
const run = (files) => {
  const r = tmp();
  for (const [rel, text] of Object.entries(files)) put(r, rel, text);
  return checkRichtext(r, CFG);
};
const BAD = 'packages/ui/src/components/Hero/Hero.ts';
const OK = 'packages/core/src/richtext/render.ts';

// One real package per restricted pattern. A new pattern without an example fails below.
const EXAMPLES = {
  unified: 'unified',
  remark: 'remark',
  'remark-*': 'remark-parse',
  rehype: 'rehype',
  'rehype-*': 'rehype-sanitize',
  'hast-*': 'hast-util-sanitize',
  'mdast-*': 'mdast-util-to-hast',
  marked: 'marked',
  'markdown-it': 'markdown-it',
  'sanitize-html': 'sanitize-html',
  dompurify: 'dompurify',
  '@astrojs/markdown-*': '@astrojs/markdown-remark',
};
const FORMS = [
  (p) => `import x from '${p}';\n`,
  (p) => `import '${p}';\n`,
  (p) => `import type { X } from '${p}';\n`,
  (p) => `export { x } from '${p}';\n`,
  (p) => `const x = await import('${p}');\n`,
  (p) => `const x = require('${p}');\n`,
  (p) => `import x from '${p}/lib/index.js';\n`,
];

test('richtext rules: the config section is complete and fails closed', () => {
  assertRichtextRules(CFG);
  assert.deepEqual(CFG.allowedIn, ['packages/core/src/richtext/**']);
  assert.deepEqual(Object.keys(EXAMPLES).sort(), [...CFG.restrictedImports].sort());
  assert.equal(CFG.bannedTokens.length, 2);
  assert.throws(() => checkRichtext(tmp(), undefined), /"richtext" section is missing/);
  for (const k of ['allowedIn', 'scan', 'restrictedImports', 'bannedTokens'])
    assert.throws(() => assertRichtextRules({ ...CFG, [k]: [] }), new RegExp(`richtext\\.${k}`));
  assert.throws(() => assertRichtextRules({ ...CFG, bannedTokenExceptions: 'x' }), /Exceptions/);
});

test('richtext rules: packageName', () => {
  assert.equal(packageName('rehype-sanitize/lib/schema.js'), 'rehype-sanitize');
  assert.equal(packageName('@astrojs/markdown-remark/dist/x.js'), '@astrojs/markdown-remark');
  assert.equal(packageName('unified'), 'unified');
});

test('richtext rules: restricted imports fail outside the richtext folder', () => {
  for (const [pattern, pkg] of Object.entries(EXAMPLES))
    for (const form of FORMS) {
      const p = run({ [BAD]: `// x\n${form(pkg)}` });
      assert.deepEqual(
        p.map((x) => `${x.at} ${x.rule}`),
        [`${BAD}:2 richtext-import`],
        `${pattern}: ${form(pkg)}`,
      );
    }
  const playground = run({
    'playground/src/a.astro': "---\nimport { marked } from 'marked';\n---\n",
  });
  assert.deepEqual(
    playground.map((x) => x.at),
    ['playground/src/a.astro:2'],
  );
});

test('richtext rules: restricted imports are allowed in the richtext folder; near misses pass', () => {
  for (const pkg of Object.values(EXAMPLES))
    for (const form of FORMS)
      assert.deepEqual(run({ [OK]: form(pkg) }), [], `${pkg}: ${form(pkg)}`);
  const nearMiss = [
    'markedly',
    'unified-args-x',
    'remarkable',
    '@astrojs/check',
    '@pwp/core/richtext',
    'astro:assets',
    'hast',
  ];
  for (const pkg of nearMiss)
    assert.deepEqual(run({ [BAD]: `import x from '${pkg}';\n` }), [], pkg);
  // Outside the scanned code (scripts/, docs/) imports are not this rule's business.
  assert.deepEqual(run({ 'scripts/x.mjs': "import { unified } from 'unified';\n" }), []);
});

test('richtext rules: astro:content fails outside the richtext folder', () => {
  const page = 'packages/ui/src/pages/[slug].astro';
  const fail = [
    "---\nimport { getEntry, render } from 'astro:content';\n---\n",
    "---\nimport * as content from 'astro:content';\n---\n",
    "const { render } = await import('astro:content');\n",
  ];
  for (const src of fail) {
    const p = run({ [page]: src.startsWith('---') ? src : `---\n${src}---\n` });
    assert.deepEqual(
      p.map((x) => `${x.at} ${x.rule}`),
      [`${page}:2 richtext-astro-content`],
      src,
    );
  }
  assert.deepEqual(
    run({ 'packages/core/src/richtext/x.ts': "import { render } from 'astro:content';\n" }),
    [],
  );
  assert.deepEqual(run({ [page]: "---\nimport { Image } from 'astro:assets';\n---\n" }), []);
});

test('richtext rules: <Content /> fails outside the richtext folder', () => {
  for (const [file, src] of [
    ['packages/ui/src/components/About/About.astro', '---\n---\n<Content />\n'],
    ['packages/ui/src/components/About/About.astro', '<section>\n  <Content/>\n</section>\n'],
    ['packages/ui/src/components/About/island.tsx', 'export const A = () => (\n  <Content>\n);\n'],
  ]) {
    const p = run({ [file]: src });
    assert.equal(p.length, 1, `${file}: ${JSON.stringify(p)}`);
    assert.equal(p[0].rule, 'richtext-content-component');
    assert.ok(p[0].at.endsWith(`:${src.split('\n').findIndex((l) => l.includes('<Content')) + 1}`));
  }
  const ok = '<ContentBlock />\n<Contents />\n';
  assert.deepEqual(run({ 'packages/ui/src/components/About/About.astro': ok }), []);
  assert.deepEqual(run({ 'packages/core/src/richtext/Render.astro': '<Content />\n' }), []);
  // A .ts file may mention the tag in a string; only markup files are checked.
  assert.deepEqual(run({ [BAD]: "const s = '<Content />';\n" }), []);
});

test('richtext rules: Markdown imports and import.meta.glob of Markdown fail', () => {
  const fail = [
    "import About from './about.md';\n",
    "import About from '../content/about.mdx';\n",
    "import raw from './about.md?raw';\n",
    "const page = await import('./pages/about.MD');\n",
    "const pages = import.meta.glob('./pages/*.md');\n",
    "const pages = import.meta.glob('../content/**/*.{md,mdx}', { eager: true });\n",
    "const pages = import.meta.glob(['./a/*.ts', './b/*.mdx']);\n",
  ];
  for (const src of fail) {
    const p = run({ [BAD]: `// x\n${src}` });
    assert.deepEqual(
      p.map((x) => `${x.at} ${x.rule}`),
      [`${BAD}:2 richtext-markdown-import`],
      src,
    );
  }
  const ok = [
    "import menu from './menu.json';\n",
    "import { md } from './mdhelpers.ts';\n",
    "const parts = import.meta.glob('./variants/*.astro');\n",
    "const x = import.meta.glob('./*.mdo.ts');\n",
  ];
  for (const src of ok) assert.deepEqual(run({ [BAD]: src }), [], src);
  assert.deepEqual(run({ [OK]: fail.join('') }), []);
});

test('richtext rules: banned tokens fail anywhere in the repo, the richtext folder included', () => {
  for (const token of CFG.bannedTokens) {
    const files = [
      'docs/guides/content.md',
      OK,
      'packages/core/package.json',
      '.github/workflows/ci.yml',
      'README.md',
    ];
    for (const file of files) {
      const p = run({ [file]: `line one\nuse ${token} here\n` });
      assert.deepEqual(
        p.map((x) => `${x.at} ${x.rule}`),
        [`${file}:2 richtext-banned-token`],
        `${token} in ${file}`,
      );
    }
    // Case does not help.
    const mixed = token.toUpperCase();
    assert.equal(run({ 'docs/x.md': mixed }).length, 1, mixed);
  }
});

test('richtext rules: banned-token exceptions, dependencies, build output and binaries pass', () => {
  const [a, b] = CFG.bannedTokens;
  const files = {
    'packages/core/src/richtext/render.ts': "import { unified } from 'unified';\n",
    // Near misses: other options and packages of the same family.
    'docs/x.md':
      'allowDangerousCharacters and allowDangerousProtocol; rehype-sanitize, rehype-stringify\n',
    'node_modules/x/index.js': a,
    'packages/core/node_modules/y/index.js': b,
    'packages/ui/dist/index.js': a,
    '.git/COMMIT_EDITMSG': b,
    'packages/ui/assets/img.bin': `\u0000${a}`,
  };
  for (const ex of CFG.bannedTokenExceptions) files[ex] = `${a} ${b}`;
  assert.deepEqual(run(files), []);
});

test('richtext rules: symlinks are not followed', () => {
  // A link target inside the repo is scanned at its real path; one outside is not repo content.
  const r = tmp();
  const outside = tmp();
  put(outside, 'evil.ts', `import x from 'rehype-sanitize';\n${CFG.bannedTokens[0]}\n`);
  mkdirSync(join(r, 'packages/ui/src'), { recursive: true });
  symlinkSync(outside, join(r, 'packages/ui/src/linked'));
  assert.deepEqual(checkRichtext(r, CFG), []);
});

test('richtext rules: the repository itself passes', () => {
  assert.deepEqual(checkRichtext(REPO, CFG), []);
});
