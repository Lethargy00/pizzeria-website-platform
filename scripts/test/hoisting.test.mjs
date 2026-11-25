// #222: pnpm must not hoist packages, so a package can load only the dependencies it declares
// (no phantom dependencies). This pins `hoistPattern: []` and `publicHoistPattern: []` in
// pnpm-workspace.yaml, keeps hoist settings out of .npmrc (which would override the workspace
// file), and, after an install, checks the effective result in node_modules/.modules.yaml.
// Dependency-free: each file is read as text and checked line by line at the top level.
// Exceptions follow DECISIONS 86: they need review:security and a new DECISIONS entry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Fold spelling variants (camelCase, kebab-case, snake_case, any case) to one name.
const fold = (key) => key.toLowerCase().replace(/[-_]/g, '');

// Top-level `key: value` lines (no indentation). Quoted keys count too, because YAML treats
// `'hoistPattern':` and `hoistPattern:` as the same key. The value has any trailing comment removed.
function topLevelEntries(text) {
  const out = [];
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  lines.forEach((line, i) => {
    const m = /^(?:(['"])(.+?)\1|([^\s'"#:][^:]*?))\s*:(?:\s+(.*))?$/.exec(line);
    if (!m) return;
    const value = (m[4] ?? '').replace(/(^|\s+)#.*$/, '').trim();
    out.push({ key: m[2] ?? m[3], quoted: m[1] !== undefined, value, line: i + 1 });
  });
  return out;
}

// Keys that change what pnpm hoists or how node_modules is laid out.
const RISKY_KEYS = new Set(['hoist', 'shamefullyhoist', 'nodelinker']);

/** pnpm-workspace.yaml text -> list of problems (empty when it is safe). */
export function checkWorkspace(text) {
  const problems = [];
  const entries = topLevelEntries(text);
  for (const name of ['hoistPattern', 'publicHoistPattern']) {
    const found = entries.filter((e) => fold(e.key) === fold(name));
    if (found.length === 0) {
      problems.push(`pnpm-workspace.yaml: \`${name}: []\` is missing. Add it at the top level.`);
      continue;
    }
    if (found.length > 1) {
      problems.push(
        `pnpm-workspace.yaml: \`${name}\` appears ${found.length} times (lines ${found
          .map((e) => e.line)
          .join(', ')}). Keep exactly one \`${name}: []\`.`,
      );
    }
    for (const e of found) {
      if (e.key !== name || e.quoted || e.value !== '[]') {
        problems.push(
          `pnpm-workspace.yaml:${e.line}: \`${e.key}: ${e.value}\` must be written exactly as \`${name}: []\` ` +
            '(no block list, no entries). Exceptions need review:security and a DECISIONS entry (#222).',
        );
      }
    }
  }
  for (const e of entries) {
    if (RISKY_KEYS.has(fold(e.key))) {
      problems.push(
        `pnpm-workspace.yaml:${e.line}: \`${e.key}\` changes hoisting or the node_modules layout. ` +
          'Remove it; hoisting is pinned by hoistPattern/publicHoistPattern (#222).',
      );
    }
    if (e.key === '<<') {
      problems.push(
        `pnpm-workspace.yaml:${e.line}: a top-level merge key (\`<<\`) can inject settings this check cannot see. Remove it.`,
      );
    }
  }
  return problems;
}

/** .npmrc text -> list of problems. A hoist setting here overrides pnpm-workspace.yaml. */
export function checkNpmrc(text) {
  const problems = [];
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const patterns = [
    /^\s*["']?(public[-_])?hoist([-_]pattern)?\b/i,
    /^\s*["']?shamefully[-_]hoist\b/i,
    /^\s*["']?node[-_]linker\b/i,
  ];
  lines.forEach((line, i) => {
    if (patterns.some((re) => re.test(line))) {
      problems.push(
        `.npmrc:${i + 1}: \`${line.trim()}\` sets hoisting in .npmrc, which overrides pnpm-workspace.yaml. ` +
          'Remove the line; hoisting is configured only in pnpm-workspace.yaml (#222).',
      );
    }
  });
  return problems;
}

/** node_modules/.modules.yaml text (written by pnpm install) -> list of problems. */
export function checkModulesYaml(text) {
  const problems = [];
  const entries = topLevelEntries(text);
  const get = (name) => entries.filter((e) => e.key === name);
  const hoisted = get('hoistedDependencies');
  if (hoisted.length !== 1 || hoisted[0].value !== '{}') {
    problems.push(
      'node_modules/.modules.yaml: `hoistedDependencies` is not `{}`, so the install hoisted packages. ' +
        'Delete node_modules and reinstall (#222).',
    );
  }
  for (const name of ['hoistPattern', 'publicHoistPattern']) {
    for (const e of get(name)) {
      if (e.value !== '[]') {
        problems.push(
          `node_modules/.modules.yaml:${e.line}: \`${name}\` is not \`[]\`; the install used a hoist pattern. ` +
            'Delete node_modules and reinstall (#222).',
        );
      }
    }
  }
  for (const e of get('nodeLinker')) {
    if (e.value !== 'isolated') {
      problems.push(
        `node_modules/.modules.yaml:${e.line}: \`nodeLinker: ${e.value}\`; only \`isolated\` keeps dependencies separate (#222).`,
      );
    }
  }
  return problems;
}

/** All three checks; `modules` is optional (absent before an install). */
export function checkHoisting({ workspace, npmrc, modules }) {
  return [
    ...checkWorkspace(workspace),
    ...checkNpmrc(npmrc),
    ...(modules === undefined ? [] : checkModulesYaml(modules)),
  ];
}

// ---- the real files ----

test('pnpm-workspace.yaml pins hoistPattern: [] and publicHoistPattern: []', () => {
  assert.deepEqual(checkWorkspace(readFileSync(join(ROOT, 'pnpm-workspace.yaml'), 'utf8')), []);
});

test('.npmrc has no hoist setting', () => {
  assert.deepEqual(checkNpmrc(readFileSync(join(ROOT, '.npmrc'), 'utf8')), []);
});

test('node_modules/.modules.yaml shows nothing was hoisted', (t) => {
  const path = join(ROOT, 'node_modules', '.modules.yaml');
  if (!existsSync(path)) {
    t.skip('node_modules/.modules.yaml is absent (no install yet); effective-result check skipped');
    return;
  }
  assert.deepEqual(checkModulesYaml(readFileSync(path, 'utf8')), []);
});

// ---- fixtures ----

const GOOD_WORKSPACE = `packages:
  - packages/*
# comment
hoistPattern: []
publicHoistPattern: [] # pinned
onlyBuiltDependencies: []
overrides:
  hoistPattern: ignored-because-indented
`;
const GOOD_NPMRC = `save-exact=true
engine-strict=true
# hoist-pattern[]=* is a comment
`;
const GOOD_MODULES = `hoistPattern: []
hoistedDependencies: {}
included:
  dependencies: true
nodeLinker: isolated
publicHoistPattern: []
`;

test('accepts the safe forms', () => {
  assert.deepEqual(
    checkHoisting({ workspace: GOOD_WORKSPACE, npmrc: GOOD_NPMRC, modules: GOOD_MODULES }),
    [],
  );
  assert.deepEqual(checkHoisting({ workspace: GOOD_WORKSPACE, npmrc: GOOD_NPMRC }), []);
  assert.deepEqual(checkWorkspace(GOOD_WORKSPACE.replace(/\n/g, '\r\n')), []);
});

const ws = (body) => `packages:\n  - packages/*\n${body}onlyBuiltDependencies: []\n`;
const BOTH = 'hoistPattern: []\npublicHoistPattern: []\n';

const badWorkspaces = {
  "hoistPattern: ['*']": ws("hoistPattern: ['*']\npublicHoistPattern: []\n"),
  "publicHoistPattern: ['*']": ws("hoistPattern: []\npublicHoistPattern: ['*']\n"),
  'hoistPattern with a named entry': ws("hoistPattern: ['eslint']\npublicHoistPattern: []\n"),
  'missing hoistPattern': ws('publicHoistPattern: []\n'),
  'missing publicHoistPattern': ws('hoistPattern: []\n'),
  'both keys missing': ws(''),
  'only indented (not top-level)': ws('settings:\n  hoistPattern: []\n  publicHoistPattern: []\n'),
  'block-list form': ws("hoistPattern:\n  - '*'\npublicHoistPattern: []\n"),
  'empty block (null)': ws('hoistPattern:\npublicHoistPattern: []\n'),
  'value on the next line': ws('hoistPattern:\n  []\npublicHoistPattern: []\n'),
  'duplicate key': ws(`${BOTH}hoistPattern: ['*']\n`),
  'duplicate key, both empty': ws(`${BOTH}hoistPattern: []\n`),
  'quoted duplicate key': ws(`${BOTH}"hoistPattern": ['*']\n`),
  'quoted key only': ws("'hoistPattern': []\npublicHoistPattern: []\n"),
  'kebab-case duplicate': ws(`${BOTH}hoist-pattern: ['*']\n`),
  'string instead of list': ws("hoistPattern: '*'\npublicHoistPattern: []\n"),
  'hoist: true': ws(`${BOTH}hoist: true\n`),
  'shamefullyHoist: true': ws(`${BOTH}shamefullyHoist: true\n`),
  'nodeLinker: hoisted': ws(`${BOTH}nodeLinker: hoisted\n`),
  'merge key': ws(`${BOTH}<<: { hoistPattern: ['*'] }\n`),
};

for (const [name, text] of Object.entries(badWorkspaces)) {
  test(`rejects pnpm-workspace.yaml: ${name}`, () => {
    assert.notDeepEqual(checkWorkspace(text), [], name);
    assert.notDeepEqual(checkHoisting({ workspace: text, npmrc: GOOD_NPMRC }), [], name);
  });
}

const badNpmrc = [
  'public-hoist-pattern[]=*',
  'hoist=true',
  'hoist=false',
  'hoist-pattern[]=*',
  'hoist-pattern[]=',
  '  Hoist-Pattern[] = *',
  'public_hoist_pattern[]=*',
  '"hoist"=true',
  'shamefully-hoist=true',
  'node-linker=hoisted',
];

for (const line of badNpmrc) {
  test(`rejects .npmrc line: ${line}`, () => {
    const text = `${GOOD_NPMRC}${line}\n`;
    assert.notDeepEqual(checkNpmrc(text), [], line);
    assert.notDeepEqual(checkHoisting({ workspace: GOOD_WORKSPACE, npmrc: text }), [], line);
  });
}

const badModules = {
  'hoisted dependencies': GOOD_MODULES.replace(
    'hoistedDependencies: {}',
    "hoistedDependencies:\n  'zod@4.0.0':\n    zod: private",
  ),
  'hoistedDependencies missing': GOOD_MODULES.replace('hoistedDependencies: {}\n', ''),
  "hoistPattern: ['*'] (block list)": GOOD_MODULES.replace(
    'hoistPattern: []',
    "hoistPattern:\n  - '*'",
  ),
  'publicHoistPattern non-empty': GOOD_MODULES.replace(
    'publicHoistPattern: []',
    "publicHoistPattern:\n  - '*'",
  ),
  'nodeLinker: hoisted': GOOD_MODULES.replace('nodeLinker: isolated', 'nodeLinker: hoisted'),
};

for (const [name, text] of Object.entries(badModules)) {
  test(`rejects node_modules/.modules.yaml: ${name}`, () => {
    assert.notDeepEqual(checkModulesYaml(text), [], name);
    assert.notDeepEqual(
      checkHoisting({ workspace: GOOD_WORKSPACE, npmrc: GOOD_NPMRC, modules: text }),
      [],
      name,
    );
  });
}

test('a leading byte order mark does not hide the first key', () => {
  assert.deepEqual(checkWorkspace(`\uFEFF${BOTH}`), []);
  assert.notDeepEqual(checkWorkspace(`\uFEFFhoistPattern: ['*']\npublicHoistPattern: []\n`), []);
  assert.notDeepEqual(checkNpmrc('\uFEFFhoist=true\n'), []);
});

test('problems name the file, the line and the fix', () => {
  const [p] = checkWorkspace(ws("hoistPattern: ['*']\npublicHoistPattern: []\n"));
  assert.match(p, /^pnpm-workspace\.yaml:3: /);
  assert.match(p, /hoistPattern: \[\]/);
  const [n] = checkNpmrc('hoist=true\n');
  assert.match(n, /^\.npmrc:1: .*Remove the line/);
});
