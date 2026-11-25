// #240: a workspace package may import only the packages its own package.json declares.
// Node walks up to the root node_modules, so without this check a package could load a root
// devDependency (eslint, prettier, vitest, …) that it never declared.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkDeclaredImports,
  classifySpecifier,
  findDynamicImports,
  findReferenceTypes,
  workspaceUnits,
  UNDECLARED_ALLOW,
} from '../check-boundaries.mjs';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const tmp = () => mkdtempSync(join(tmpdir(), 'pwp-decl-'));
const put = (root, rel, text = '') => {
  mkdirSync(join(root, rel, '..'), { recursive: true });
  writeFileSync(join(root, rel), text);
};
const manifest = (name, fields = {}) => JSON.stringify({ name, version: '0.0.0', ...fields });

/** A repo with one package, packages/ui (@pwp/ui), declaring `fields`, plus these files. */
const run = (files, fields = {}, allow = []) => {
  const r = tmp();
  put(r, 'packages/ui/package.json', manifest('@pwp/ui', fields));
  for (const [rel, text] of Object.entries(files)) put(r, rel, text);
  return checkDeclaredImports(r, { allow });
};
const ats = (problems) => problems.map((p) => p.at);
const FILE = 'packages/ui/src/a.ts';

// Every static and literal-dynamic import form. Line 2, so the reported line is checked too.
const FORMS = [
  (p) => `import x from '${p}';`,
  (p) => `import '${p}';`,
  (p) => `import * as x from "${p}";`,
  (p) => `import type { X } from '${p}';`,
  (p) => `import { type X, y } from '${p}';`,
  (p) => `export { x } from '${p}';`,
  (p) => `export * from '${p}';`,
  (p) => `export type { X } from '${p}';`,
  (p) => `const x = await import('${p}');`,
  (p) => `const x = await import( "${p}" );`,
  (p) => `const x = require('${p}');`,
  (p) => `type X = typeof import('${p}');`,
  (p) => `import {\n  a,\n  b,\n} from '${p}';`,
];

test('declared imports pass in every form (dependencies, devDependencies, peerDependencies)', () => {
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies'])
    for (const form of FORMS) {
      const src = `// x\n${form('zod')}\n`;
      assert.deepEqual(run({ [FILE]: src }, { [field]: { zod: '4.6.7' } }), [], `${field}: ${src}`);
    }
});

test('an undeclared root devDependency fails in every form, with file, line and fix', () => {
  for (const dep of ['prettier', 'vitest', 'eslint', 'typescript', 'turbo'])
    for (const form of FORMS) {
      const src = `// x\n${form(dep)}\n`;
      const p = run({ [FILE]: src }, { dependencies: { zod: '4.6.7' } });
      assert.deepEqual(ats(p), [`${FILE}:2`], `${dep}: ${src}`);
      assert.match(p[0].message, new RegExp(`loads "${dep}", which @pwp/ui does not declare`));
      assert.match(p[0].message, /packages\/ui\/package\.json/);
      assert.match(p[0].message, /dependencies, devDependencies, peerDependencies/);
      assert.match(p[0].message, /approved type:dependency issue, or remove the import/);
    }
});

test('optionalDependencies and other fields do not count as declaring', () => {
  for (const field of ['optionalDependencies', 'bundleDependencies', 'peerDependenciesMeta'])
    assert.deepEqual(
      ats(run({ [FILE]: "import 'zod';\n" }, { [field]: { zod: '4.6.7' } })),
      [`${FILE}:1`],
      field,
    );
});

test('Node builtins pass; bare names that are builtins only with node: do not', () => {
  const ok = [
    'node:fs',
    'node:fs/promises',
    'fs',
    'fs/promises',
    'path',
    'node:test',
    'node:sqlite',
    'node:module',
  ];
  for (const spec of ok) {
    assert.equal(classifySpecifier(spec).kind, 'builtin', spec);
    assert.deepEqual(run({ [FILE]: `import x from '${spec}';\n` }), [], spec);
  }
  // `test` and `sqlite` resolve to npm packages of that name; they must be declared.
  for (const spec of ['test', 'sqlite', 'fs/promises/x'])
    assert.deepEqual(ats(run({ [FILE]: `import x from '${spec}';\n` })), [`${FILE}:1`], spec);
  const bogus = run({ [FILE]: "import x from 'node:nope';\n" });
  assert.deepEqual(ats(bogus), [`${FILE}:1`]);
  assert.match(bogus[0].message, /not a Node builtin/);
});

test('scoped and subpath specifiers resolve to the package name', () => {
  assert.deepEqual(classifySpecifier('zod/v4/core'), { kind: 'package', name: 'zod' });
  assert.deepEqual(classifySpecifier('@astrojs/check/dist/x.js'), {
    kind: 'package',
    name: '@astrojs/check',
  });
  assert.deepEqual(classifySpecifier('@types/node'), { kind: 'package', name: '@types/node' });
  const fields = { dependencies: { zod: '4.6.7', '@scope/name': '1.0.0' } };
  for (const spec of ['zod/v4', 'zod/v4/core', '@scope/name', '@scope/name/sub/path.js'])
    assert.deepEqual(run({ [FILE]: `import x from '${spec}';\n` }, fields), [], spec);
  // Neither the scope alone nor a sibling in the same scope is covered.
  for (const spec of ['@scope/other', '@scope/other/sub', 'zodiac', 'zod-extra/x'])
    assert.deepEqual(
      ats(run({ [FILE]: `import x from '${spec}';\n` }, fields)),
      [`${FILE}:1`],
      spec,
    );
  for (const spec of ['@scope', '@/x', '@scope/', '@', '%zod'])
    assert.equal(classifySpecifier(spec).kind, 'invalid', spec);
});

test('own package name, @pwp/* and relative imports', () => {
  const files = {
    [FILE]: "import { a } from '@pwp/ui/sub';\nimport { b } from './b.js';\nimport '../c.js';\n",
    'packages/ui/src/b.ts': '',
  };
  assert.deepEqual(run(files), []);
  // Another workspace package is a dependency like any other: it must be declared.
  assert.deepEqual(ats(run({ [FILE]: "import { a } from '@pwp/core';\n" })), [`${FILE}:1`]);
  assert.deepEqual(
    run(
      { [FILE]: "import { a } from '@pwp/core';\n" },
      { dependencies: { '@pwp/core': 'workspace:*' } },
    ),
    [],
  );
});

test('dynamic import() and require() with a non-literal argument are reported', () => {
  const bad = [
    'const m = await import(name);',
    'const m = await import(`zod`);',
    'const m = await import(`${base}/x.js`);',
    "const m = await import('zo' + 'd');",
    'const m = require(name);',
    'const m = require (`x`);',
    'const m = await import(\n  name\n);',
    // A literal prefix does not say what is loaded.
    "const m = await import('./x/' + name);",
    "const m = await import('zod' + suffix);",
    "const m = require('zod'.concat(x));",
    "const m = await import('zod'\n  + x);",
    // module.require loads modules like require does.
    'const m = module.require(name);',
  ];
  for (const src of bad) {
    const p = run({ [FILE]: `// x\n${src}\n` }, { dependencies: { zod: '4.6.7' } });
    assert.ok(
      p.some((x) => x.at === `${FILE}:2` && /non-literal argument/.test(x.message)),
      src,
    );
  }
  const opaque = [
    "import { createRequire } from 'node:module';",
    'const r = module.createRequire(import.meta.url);',
    'Module._load(x);',
    'process.mainModule.require(x);',
  ];
  for (const src of opaque) {
    const p = run({ [FILE]: `// x\n${src}\n` });
    assert.ok(
      p.some((x) => x.at === `${FILE}:2` && /cannot follow/.test(x.message)),
      src,
    );
  }
  const ok = [
    'const u = import.meta.url;',
    'const m = await import("zod");',
    "const m = await import('zod', { with: { type: 'json' } });",
    "const m = await import( 'zod' );",
    "const m = module.require('zod');",
    'obj.import(name);',
    'myimport(name);',
    '$import(name);',
    'myrequire(name);',
    'const required = 1;',
    'const createRequired = 1;',
  ];
  for (const src of ok)
    assert.deepEqual(run({ [FILE]: `${src}\n` }, { dependencies: { zod: '4.6.7' } }), [], src);
  // module.require of an undeclared package is checked like require.
  assert.deepEqual(ats(run({ [FILE]: "module.require('prettier');\n" })), [`${FILE}:1`]);
  assert.deepEqual(findDynamicImports("import(a);\nrequire(b);\nimport('c');"), [
    { kind: 'import()', line: 1 },
    { kind: 'require()', line: 2 },
  ]);
});

test('/// <reference types> needs the package or its @types package declared', () => {
  const src = '/// <reference types="node" />\nexport {};\n';
  assert.deepEqual(findReferenceTypes(src), [{ spec: 'node', line: 1 }]);
  const p = run({ [FILE]: src });
  assert.deepEqual(ats(p), [`${FILE}:1`]);
  assert.match(p[0].message, /loads "node" or "@types\/node"/);
  assert.deepEqual(run({ [FILE]: src }, { devDependencies: { '@types/node': '24.0.10' } }), []);
  assert.deepEqual(
    run(
      { [FILE]: '/// <reference types="@scope/pkg" />\n' },
      { devDependencies: { '@types/scope__pkg': '1.0.0' } },
    ),
    [],
  );
  assert.deepEqual(
    run(
      { [FILE]: "/// <reference types='vite/client' />\n" },
      { devDependencies: { vite: '7.0.0' } },
    ),
    [],
  );
  assert.deepEqual(ats(run({ [FILE]: '/// <reference types="./local" />\n' })), [`${FILE}:1`]);
  // A reference path is a file, not a package.
  assert.deepEqual(run({ [FILE]: '/// <reference path="./env.d.ts" />\n' }), []);
});

test('URL, unknown-scheme, absolute and "#" alias specifiers fail; astro: needs astro', () => {
  for (const [spec, why] of [
    ['https://cdn.example.com/x.js', /URL or unknown-scheme/],
    ['data:text/javascript,export default 1', /URL or unknown-scheme/],
    ['file:///etc/passwd', /URL or unknown-scheme/],
    ['bun:sqlite', /URL or unknown-scheme/],
    ['/abs/x.js', /absolute path/],
    ['#internal/x', /"imports" alias/],
  ]) {
    const p = run({ [FILE]: `import x from '${spec}';\n` });
    assert.deepEqual(ats(p), [`${FILE}:1`], spec);
    assert.match(p[0].message, why, spec);
  }
  const astro = "---\nimport { Image } from 'astro:assets';\n---\n";
  const file = 'packages/ui/src/X.astro';
  assert.deepEqual(ats(run({ [file]: astro })), [`${file}:2`]);
  assert.deepEqual(run({ [file]: astro }, { dependencies: { astro: '5.0.0' } }), []);
});

test('every code extension is scanned; node_modules and dist are not', () => {
  for (const ext of ['js', 'mjs', 'cjs', 'jsx', 'ts', 'mts', 'cts', 'tsx', 'astro', 'd.ts'])
    assert.deepEqual(
      ats(run({ [`packages/ui/src/x.${ext}`]: "import 'prettier';\n" })),
      [`packages/ui/src/x.${ext}:1`],
      ext,
    );
  assert.deepEqual(
    run({
      'packages/ui/node_modules/x/index.js': "import 'prettier';\n",
      'packages/ui/dist/index.js': "import 'prettier';\n",
      'packages/ui/README.md': "import 'prettier';\n",
    }),
    [],
  );
});

test('tests are checked like source', () => {
  for (const f of [
    'packages/ui/src/a.test.ts',
    'packages/ui/test/a.spec.ts',
    'packages/ui/bin/x.mjs',
  ])
    assert.deepEqual(ats(run({ [f]: "import { test } from 'vitest';\n" })), [`${f}:1`], f);
});

test('every folder in packages/ and playground/ is a unit; a missing or broken manifest fails closed', () => {
  const r = tmp();
  put(r, 'packages/a/package.json', manifest('@pwp/a'));
  put(r, 'packages/b/src/x.ts', "import 'prettier';\n");
  put(r, 'packages/c/package.json', '{ not json');
  put(r, 'packages/d/package.json', manifest('@pwp/d', { dependencies: ['zod'] }));
  put(r, 'packages/e/package.json', JSON.stringify({ dependencies: {} }));
  put(r, 'packages/README.md', 'not a package');
  put(r, 'playground/package.json', manifest('@pwp/playground'));
  put(r, 'playground/src/x.ts', "import 'prettier';\n");
  assert.deepEqual(workspaceUnits(r), [
    'packages/a',
    'packages/b',
    'packages/c',
    'packages/d',
    'packages/e',
    'playground',
  ]);
  const p = checkDeclaredImports(r, { allow: [] });
  assert.deepEqual(ats(p), [
    'packages/b/package.json',
    'packages/c/package.json',
    'packages/d/package.json',
    'packages/e/package.json',
    'playground/src/x.ts:1',
  ]);
  assert.match(p[0].message, /cannot read it \(ENOENT\)/);
  assert.match(p[2].message, /"dependencies" is not an object/);
  assert.match(p[3].message, /"name" is missing/);
});

test('allow-list: an entry suppresses exactly its package and dependency', () => {
  const allow = [{ package: '@pwp/ui', dependency: 'vitest', issue: '#241' }];
  const files = {
    'packages/ui/src/a.test.ts': "import { test } from 'vitest';\n",
    'packages/ui/src/b.test.ts': "import { test } from 'vitest/config';\nimport 'prettier';\n",
    'packages/core/package.json': manifest('@pwp/core'),
    'packages/core/src/c.test.ts': "import { test } from 'vitest';\n",
  };
  assert.deepEqual(ats(run(files, {}, allow)), [
    'packages/core/src/c.test.ts:1',
    'packages/ui/src/b.test.ts:2',
  ]);
  // An allow-listed @types package covers a reference-types directive too.
  assert.deepEqual(
    run({ [FILE]: '/// <reference types="node" />\n' }, {}, [
      { package: '@pwp/ui', dependency: '@types/node', issue: '#241' },
    ]),
    [],
  );
});

test('allow-list: stale, duplicate and malformed entries fail', () => {
  const stale = run(
    { [FILE]: "import 'zod';\n" },
    { devDependencies: { vitest: '4.1.7', zod: '4.6.7' } },
    [{ package: '@pwp/ui', dependency: 'vitest', issue: '#241' }],
  );
  assert.deepEqual(ats(stale), ['scripts/check-boundaries.mjs UNDECLARED_ALLOW[0]']);
  assert.match(stale[0].message, /Stale allow-list entry: @pwp\/ui no longer imports "vitest"/);

  const used = "import 'vitest';\n";
  const dup = run({ [FILE]: used }, {}, [
    { package: '@pwp/ui', dependency: 'vitest', issue: '#241' },
    { package: '@pwp/ui', dependency: 'vitest', issue: '#242' },
  ]);
  assert.deepEqual(ats(dup), ['scripts/check-boundaries.mjs UNDECLARED_ALLOW[1]']);
  assert.match(dup[0].message, /Duplicate/);

  for (const bad of [
    { package: '@pwp/ui', dependency: 'vitest' },
    { package: '@pwp/ui', dependency: 'vitest', issue: '241' },
    { package: '@pwp/ui', dependency: 'vitest', issue: '#0' },
    { package: '@pwp/ui', dependency: 'vitest', issue: 'TODO' },
    { package: '@pwp/ui', issue: '#241' },
    null,
  ]) {
    const p = run({ [FILE]: used }, {}, [bad]);
    // The malformed entry is reported AND does not suppress anything.
    assert.deepEqual(
      ats(p),
      ['scripts/check-boundaries.mjs UNDECLARED_ALLOW[0]', `${FILE}:1`],
      JSON.stringify(bad),
    );
  }
});

test('the repository passes, and the allow-list is exactly what main needs', () => {
  assert.deepEqual(checkDeclaredImports(REPO), []);
  for (const a of UNDECLARED_ALLOW) assert.match(a.issue, /^#[1-9]\d*$/);
  // Without the allow-list, the only failures are the allow-listed pairs.
  const pairs = new Set(
    checkDeclaredImports(REPO, { allow: [] }).map((p) => {
      const dir = p.at.split('/').slice(0, 2).join('/');
      const dep = /loads "([^"]+)"(?: or "([^"]+)")?/.exec(p.message);
      assert.ok(dep, `unexpected problem: ${p.at} ${p.message}`);
      return `${dir} ${dep[2] ?? dep[1]}`;
    }),
  );
  const expected = new Set(
    UNDECLARED_ALLOW.map((a) => `packages/${a.package.replace('@pwp/', '')} ${a.dependency}`),
  );
  assert.deepEqual([...pairs].sort(), [...expected].sort());
});
