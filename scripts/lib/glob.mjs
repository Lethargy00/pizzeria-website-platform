// Minimal glob → RegExp for repo paths. Supports **, *, ? and {a,b}. No dependencies.
export function globToRegExp(glob) {
  let g = glob.trim().replace(/^\.?\//, '');
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
      re += '(?:' + g.slice(i + 1, end).split(',').map(escape).join('|') + ')';
      i = end;
    } else re += escape(c);
  }
  return new RegExp('^' + re + '$');
}
const escape = (s) => s.replace(/[.+^$()|[\]\\]/g, '\\$&');

export function matchesAny(path, globs) {
  return globs.some((g) => globToRegExp(g).test(path));
}
