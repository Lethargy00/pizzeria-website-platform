// Minimal glob → RegExp for repo paths. Supports **, *, ? and {a,b}. No dependencies.
//
// Matching is case-sensitive by default, which is what touches-guard, tenant-guard and the
// other callers rely on. Pass { nocase: true } to match without regard to case (#162): on a
// case-insensitive filesystem (macOS, Windows) `.PNPMFILE.cjs` is opened as `.pnpmfile.cjs`,
// so a gate that asks for review on a path must also ask for it on every case variant.

/**
 * Case-fold a path or glob for nocase matching. Upper- then lower-casing also folds the
 * non-ASCII letters that case-insensitive filesystems treat as ASCII ones: dotless `ı` and
 * long `ſ` uppercase to `I` and `S`, and the Kelvin sign lowercases to `k`. It can only make
 * more paths match (for example `ß` becomes `ss`), never fewer.
 * @param {string} s
 */
export const foldCase = (s) => s.toUpperCase().toLowerCase();

/**
 * @param {string} glob
 * @param {{ nocase?: boolean }} [opts] nocase: fold the glob and add the `i` flag. Test the
 *   result against `foldCase(path)` (matchesAny does) to cover the non-ASCII folds too.
 */
export function globToRegExp(glob, { nocase = false } = {}) {
  let g = glob.trim().replace(/^\.?\//, '');
  if (nocase) g = foldCase(g);
  if (g.endsWith('/')) g += '**';
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') {
        i++;
        if (g[i + 1] === '/') {
          i++;
          re += '(?:.*/)?';
        } else re += '.*';
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '{') {
      const end = g.indexOf('}', i);
      if (end === -1) throw new Error(`Unclosed { in glob: ${glob}`);
      re +=
        '(?:' +
        g
          .slice(i + 1, end)
          .split(',')
          .map(escape)
          .join('|') +
        ')';
      i = end;
    } else re += escape(c);
  }
  return new RegExp('^' + re + '$', nocase ? 'i' : '');
}
const escape = (s) => s.replace(/[.+^$()|[\]\\]/g, '\\$&');

/**
 * @param {string} path
 * @param {string[]} globs
 * @param {{ nocase?: boolean }} [opts] nocase: match without regard to case (see foldCase)
 */
export function matchesAny(path, globs, { nocase = false } = {}) {
  const p = nocase ? foldCase(path) : path;
  return globs.some((g) => globToRegExp(g, { nocase }).test(p));
}
