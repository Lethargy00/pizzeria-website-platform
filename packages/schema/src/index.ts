/**
 * @pwp/schema: Zod schemas: tenant config, theme tokens, menu, hours, locations, pages. The source of every contract.
 *
 * Export convention (#22): every schema folder `src/<name>/` is its own subpath, `@pwp/schema/<name>`,
 * served from `src/<name>/index.ts` by the `"./*"` pattern in `package.json`. Adding a folder needs
 * no edit to this file or to `package.json`, and this root module never re-exports a folder.
 * Only a folder's `index.ts` is public: `@pwp/schema/primitives/safe-url` resolves to
 * `src/primitives/safe-url/index.ts`, which does not exist, so other files in a folder are not
 * importable from outside the package. Do not nest a folder with its own `index.ts` unless it is
 * meant to be a public subpath.
 */
export const PACKAGE_NAME = '@pwp/schema' as const;

/**
 * The one sanctioned `z` for packages outside `@pwp/schema` (ADR 0002: only this package declares
 * `zod`). Use it only for schemas that really belong to the importing package, such as a function's
 * request body built from the primitives; tenant-facing shapes live in `@pwp/schema`. Never import
 * `zod`, `astro/zod` or the `z` from `astro:content` directly.
 */
export { z } from 'zod';
