import { readdirSync, lstatSync } from 'node:fs';
import { join, relative } from 'node:path';

/** Yields every path (files, dirs, symlinks) under root, relative to base. Does not follow symlinks. */
export function* walk(root, base = root) {
  let entries;
  try {
    entries = readdirSync(root);
  } catch {
    return;
  }
  for (const name of entries) {
    const full = join(root, name);
    const st = lstatSync(full);
    const rel = relative(base, full).split('\\').join('/');
    yield {
      path: rel,
      full,
      isDir: st.isDirectory(),
      isSymlink: st.isSymbolicLink(),
      size: st.size,
    };
    if (st.isDirectory() && !st.isSymbolicLink()) yield* walk(full, base);
  }
}
