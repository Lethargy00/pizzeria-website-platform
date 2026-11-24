import { z } from 'zod';
import {
  LOCALES,
  Slug,
  singleLineText,
  strictObject,
  type LocaleCode,
  type LocaleContext,
} from '../primitives/index.js';

/** Maximum length of a page title (`<title>`, `og:title`, the page heading). */
export const MAX_PAGE_TITLE_LENGTH = 120;

/** Maximum length of a page description (`<meta name="description">`, `og:description`). */
export const MAX_PAGE_DESCRIPTION_LENGTH = 300;

/**
 * The key of a Markdown page, e.g. `about`, `privacy`, `allergens`. A {@link Slug}: it becomes
 * part of the page's URL and other content refers to the page by it, so it can never form a path.
 * The same key is shared by every translation of a page.
 */
export const PageKey = Slug;
export type PageKey = z.infer<typeof PageKey>;

/**
 * The front matter of one `content/pages/*.md` file of a tenant (#28).
 *
 * A file is **one page in one locale**: the Markdown body is prose in that locale, so `title`
 * and `description` are plain one-line strings, not localized strings. `locale` must be one of
 * the tenant's enabled locales, so the schema is a factory of the tenant's {@link LocaleContext}
 * (ADR 0003); the loader passes the context from `parseSiteConfig`.
 *
 * ```yaml
 * ---
 * key: about
 * locale: sv
 * title: Om oss
 * description: Familjen bakom Pizzeria Exempel och vår deg.
 * ---
 * ```
 *
 * A page is identified by `key` and `locale`, not by its file name (`<key>.<locale>.md` is the
 * recommended name). Rules across files (each `key` + `locale` once, every key in every enabled
 * locale) are checked by `ContentSource.loadPages`, because one file cannot see the others.
 *
 * Throws a `TypeError` at construction when `ctx.locales` is empty or holds an unknown locale:
 * a programmer error that fails closed (ADR 0003 section 4). Tenant input cannot reach it.
 */
export function pageFrontMatterSchema(ctx: LocaleContext) {
  const known: readonly string[] = LOCALES;
  const locales = [...new Set(ctx.locales)];
  if (locales.length === 0 || locales.some((locale) => !known.includes(locale))) {
    throw new TypeError(
      `pageFrontMatterSchema needs a non-empty list of supported locales (${LOCALES.join(', ')}).`,
    );
  }
  return strictObject({
    key: PageKey,
    /** One enabled locale; anything else is a single `invalid_value` issue at `['locale']`. */
    locale: z.enum(locales as [LocaleCode, ...LocaleCode[]]),
    /** One line (`singleLineText`): no controls, line separators, bidi or zero-width characters. */
    title: singleLineText(MAX_PAGE_TITLE_LENGTH),
    description: singleLineText(MAX_PAGE_DESCRIPTION_LENGTH),
  });
}

export type PageFrontMatter = z.output<ReturnType<typeof pageFrontMatterSchema>>;
