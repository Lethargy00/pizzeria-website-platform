/**
 * The `params` that the primitives put on a Zod `custom` issue, so the error mapping (#23,
 * `@pwp/schema/errors`) can turn the code into a message and a hint.
 *
 * This mirrors `CustomIssueParams` from the #23 contract (open PR #88), which is not merged yet.
 * Once it is, this file is replaced by `import type { CustomIssueParams } from '../errors/index.js'`
 * and the helpers below type their params with it. The shape is identical, so nothing else changes.
 */
export interface PrimitiveIssueParams {
  readonly pwpCode: 'missing_locale' | 'unsafe_url' | 'unsafe_path';
  readonly locale?: string;
  readonly allowedSchemes?: readonly string[];
  readonly allowedExtensions?: readonly string[];
}
