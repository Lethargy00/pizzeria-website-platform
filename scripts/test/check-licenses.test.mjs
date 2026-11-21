import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAllowed, check } from '../check-licenses.mjs';

const accepts = [
  'MIT',
  'MIT OR GPL-3.0-only',
  'GPL-3.0-only OR MIT',
  '(MIT OR GPL-3.0-only) AND ISC',
  'MIT OR (GPL-3.0-only AND ISC)',
  'GPL-3.0-only AND ISC OR MIT', // AND binds tighter: (GPL AND ISC) OR MIT
  'MIT AND ISC',
  '((MIT))',
  '(MIT OR ISC) AND (Apache-2.0 OR GPL-3.0-only)',
  'MIT or GPL-3.0-only',
];
const rejects = [
  'GPL-3.0-only AND (MIT OR ISC)', // the finding from #130
  'GPL-3.0-only',
  'MIT AND (GPL-3.0 OR SSPL-1.0)',
  'MIT AND GPL-3.0-only',
  'GPL-3.0-only OR (SSPL-1.0 AND ISC)',
  '(MIT OR GPL-3.0-only) AND GPL-3.0-only',
  // fail closed on anything that does not parse
  '(MIT',
  'MIT)',
  '(MIT))',
  ')(MIT',
  '()',
  '',
  '   ',
  'MIT OR',
  'OR MIT',
  'MIT AND',
  'MIT OR OR ISC',
  'MIT XOR ISC',
  'MIT ISC',
  'MIT; ISC',
  'MIT OR (ISC',
  // WITH is rejected unless the whole pair is allow-listed
  'MIT WITH Classpath-exception-2.0',
  'MIT WITH',
  'MIT WITH (ISC)',
  'GPL-2.0-only WITH Classpath-exception-2.0 OR GPL-3.0-only',
  undefined,
  null,
];

test('isAllowed accepts valid allowed expressions', () => {
  for (const e of accepts) assert.equal(isAllowed(e), true, e);
});

test('isAllowed rejects disallowed and unparsable expressions (fail closed)', () => {
  for (const e of rejects) assert.equal(isAllowed(e), false, String(e));
});

test('AND binds tighter than OR', () => {
  assert.equal(isAllowed('MIT OR GPL-3.0-only AND ISC'), true); // MIT OR (GPL AND ISC)
  assert.equal(isAllowed('GPL-3.0-only AND ISC OR GPL-3.0-only'), false);
  assert.equal(isAllowed('GPL-3.0-only AND MIT OR ISC'), true); // (GPL AND MIT) OR ISC
});

test('check reports packages with a disallowed expression', () => {
  const bad = check({
    MIT: [{ name: 'a', versions: ['1.0.0'] }],
    'GPL-3.0-only AND (MIT OR ISC)': [{ name: 'b', versions: ['2.0.0'] }],
    '(MIT': [{ name: 'c', version: '3.0.0' }],
  });
  assert.deepEqual(bad, ['b@2.0.0: GPL-3.0-only AND (MIT OR ISC)', 'c@3.0.0: (MIT']);
});
