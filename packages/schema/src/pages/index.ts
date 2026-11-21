/**
 * `@pwp/schema/pages`: the contract for the front matter of a tenant's `content/pages/*.md` (#28).
 *
 * Validate with `pageFrontMatterSchema(ctx)`, where `ctx` comes from `parseSiteConfig` (ADR 0003).
 * The Markdown body is not validated here: it goes through the rich-text pipeline
 * (`@pwp/core/richtext`, ADR 0002). `ContentSource.loadPages` (`@pwp/adapters`) returns both.
 */
export {
  MAX_PAGE_TITLE_LENGTH,
  MAX_PAGE_DESCRIPTION_LENGTH,
  PageKey,
  pageFrontMatterSchema,
  type PageFrontMatter,
} from './pages.js';
