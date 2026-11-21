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

/** Pairs "LICENSE WITH EXCEPTION" that are allowed as a whole. Empty: no exception is allow-listed. */
export const ALLOWED_WITH = new Set([]);

/** Splits an SPDX expression into tokens. Returns null on a character that cannot be part of one. */
function tokenize(expr) {
  const tokens = [];
  const re = /\s*(?:(\()|(\))|([A-Za-z0-9.+:-]+))/y;
  const s = String(expr).trim();
  let i = 0;
  while (i < s.length) {
    re.lastIndex = i;
    const m = re.exec(s);
    if (!m) return null;
    tokens.push(m[1] ? '(' : m[2] ? ')' : m[3]);
    i = re.lastIndex;
  }
  return tokens;
}

const OPERATORS = new Set(['AND', 'OR', 'WITH']);

/**
 * Evaluates an SPDX license expression (SPDX spec Annex D): `WITH` binds tightest, then `AND`,
 * then `OR`; parentheses group. "A OR B" passes if either side passes, "A AND B" only if both do.
 * A `WITH` pair passes only if the whole pair is in ALLOWED_WITH. Fails closed: anything that
 * does not parse is not allowed.
 */
export function isAllowed(expr) {
  const tokens = expr == null ? null : tokenize(expr);
  if (!tokens || !tokens.length) return false;
  let pos = 0;
  const fail = () => {
    throw new SyntaxError('invalid SPDX expression');
  };
  const keyword = (k) => tokens[pos] !== undefined && tokens[pos].toUpperCase() === k;
  const isOp = (t) => t !== undefined && OPERATORS.has(t.toUpperCase());

  const parseOr = () => {
    let ok = parseAnd();
    while (keyword('OR')) {
      pos++;
      const rhs = parseAnd(); // always consume the right side
      ok = ok || rhs;
    }
    return ok;
  };
  const parseAnd = () => {
    let ok = parseTerm();
    while (keyword('AND')) {
      pos++;
      const rhs = parseTerm();
      ok = ok && rhs;
    }
    return ok;
  };
  const parseTerm = () => {
    const t = tokens[pos];
    if (t === undefined || t === ')' || isOp(t)) return fail();
    pos++;
    if (t === '(') {
      const ok = parseOr();
      if (tokens[pos] !== ')') return fail();
      pos++;
      return ok;
    }
    if (keyword('WITH')) {
      pos++;
      const exception = tokens[pos];
      if (exception === undefined || exception === '(' || exception === ')' || isOp(exception))
        return fail();
      pos++;
      return ALLOWED_WITH.has(`${t} WITH ${exception}`);
    }
    return ALLOWED.has(t);
  };

  try {
    const ok = parseOr();
    return pos === tokens.length && ok; // trailing tokens, e.g. an unmatched ")", fail closed
  } catch {
    return false;
  }
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
