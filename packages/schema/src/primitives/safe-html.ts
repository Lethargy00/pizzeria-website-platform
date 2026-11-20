/**
 * HTML that came out of the sanitizer and may be passed to an HTML sink (`set:html`,
 * `innerHTML`, …). Type only (ADR 0002, Enforcement (b) and (d)).
 *
 * - This package exports **no** constructor, Zod schema, type guard or cast helper that produces
 *   a `SafeHtml` from a string, and must never add one.
 * - The only place that creates a `SafeHtml` is `renderMarkdown` in `@pwp/core/richtext` (#47),
 *   with a single cast inside `packages/core/src/richtext/`. The check from #80 fails on any other
 *   cast to `SafeHtml`.
 * - Components that render HTML accept `SafeHtml`, never `string`. A plain `string` is not
 *   assignable to it.
 */
export type SafeHtml = string & { readonly __brand: 'SafeHtml' };
