/**
 * Content source contract (DECISIONS #13, #36; issue #28). Owner: architect.
 *
 * Every read of tenant content goes through a {@link ContentSource}: the Git/filesystem source
 * in v1 (the CLI issue implements it), a CMS adapter later. Components, `@pwp/core` and the CLI
 * pipeline depend on this interface only, so adding a CMS needs no change to them.
 *
 * Types and constants only. Implementations live elsewhere and import from here.
 *
 * ## Scope: one tenant
 *
 * A `ContentSource` is **bound to one tenant when it is created** (by its factory, outside this
 * contract). No method takes a tenant slug, a file path, a directory or a URL, so a caller cannot
 * ask one source for another tenant's data (build isolation, ADR 0001). The only reference a
 * caller passes is an `AssetRef` to {@link ContentSource.resolveAsset}, which the source checks
 * again and resolves inside that tenant's `assets/` only.
 *
 * ## Loader order (ADR 0003 section 3)
 *
 * 1. Call {@link ContentSource.loadSiteConfig}. It uses `parseSiteConfig` and returns the
 *    `LocaleContext` whenever pass 1 succeeded, even if the result has issues.
 * 2. If `context` is present, call every other loader with it, even when the site config had
 *    issues, so the tenant sees all problems in one run. If `context` is absent, call no other
 *    loader: report the site config issues and the one message "fix `locales` and
 *    `defaultLocale` first".
 * 3. The caller collects all issues. Any issue fails `pwp validate` and `pwp build`; there are no
 *    warnings (unknown keys are errors).
 *
 * ## Result rules for every method
 *
 * - **Never throws for bad tenant data.** Missing, unreadable or invalid content is reported as
 *   issues in a {@link ContentResult}. A throw means a bug or an infrastructure failure (for
 *   example the CMS is down), never a tenant mistake.
 * - **Validated.** `data` has passed the `@pwp/schema` schema for that file, built with the given
 *   context. A source never returns unvalidated or partially validated data.
 * - **All issues.** A source reports every issue it finds, not just the first. Each issue names
 *   the file inside the tenant (`tenants/<slug>/content/menu.yaml`), never an absolute path.
 * - **Absent optional files** resolve to `ok: true` with `data: undefined` (for `pages`, an empty
 *   list). Whether a file is required is the caller's decision, from the validated site config.
 *   The site config itself is always required.
 *
 * ## Follow-ups
 *
 * - The data types are slots of {@link ContentModel} because their contracts are not merged yet:
 *   `SiteConfig` (#52), `ThemeOverride` (#34 / PR #110), `Menu` (#25 / PR #127), `Hours`
 *   (#26 / PR #126), `Locations` (#27 / PR #124) and `ValidationIssue` (#23 / PR #88). A
 *   `type:contract` follow-up sets the defaults of {@link ContentModel} to those types. That is
 *   additive: implementations that already pass a concrete model keep compiling.
 * - Re-export from `interfaces/index.ts` and type tests in `interfaces.test.ts` (outside #28's
 *   Touches).
 */

import type { PageFrontMatter } from '@pwp/schema/pages';
import type { LocaleContext } from '@pwp/schema/primitives';

/**
 * The types a content source returns, one slot per tenant file. Every slot is the **output**
 * type of the matching `@pwp/schema` schema (ADR 0003 section 5).
 */
export interface ContentModel {
  /** `site.config.yaml`: `SiteConfig` from `@pwp/schema/site-config` (#52). */
  readonly siteConfig: unknown;
  /** `theme.yaml`: `ThemeOverride` from `@pwp/schema/theme` (#34). */
  readonly theme: unknown;
  /** `content/menu.yaml`: `Menu` from `@pwp/schema/menu` (#25). */
  readonly menu: unknown;
  /** `content/hours.yaml`: `Hours` from `@pwp/schema/hours` (#26). */
  readonly hours: unknown;
  /** `content/locations.yaml`: `Locations` from `@pwp/schema/locations` (#27). */
  readonly locations: unknown;
  /** One problem: `ValidationIssue` from `@pwp/schema/errors` (#23). */
  readonly issue: unknown;
}

/** At least one issue. */
export type NonEmptyIssues<I> = readonly [I, ...I[]];

/**
 * The outcome of one load: either validated data and no issues, or at least one issue and no
 * data. A source never returns both, so a caller cannot use data that failed validation.
 */
export type ContentResult<T, I> =
  | { readonly ok: true; readonly data: T; readonly issues: readonly [] }
  | { readonly ok: false; readonly data?: undefined; readonly issues: NonEmptyIssues<I> };

/**
 * The outcome of {@link ContentSource.loadSiteConfig}. Like {@link ContentResult}, plus the
 * tenant's {@link LocaleContext}: always present on success, and present on failure whenever
 * pass 1 (`locales`, `defaultLocale`) succeeded (ADR 0003 section 3).
 */
export type SiteConfigResult<T, I> =
  | (Extract<ContentResult<T, I>, { ok: true }> & { readonly context: LocaleContext })
  | (Extract<ContentResult<T, I>, { ok: false }> & { readonly context?: LocaleContext });

/**
 * One Markdown page in one locale (`content/pages/*.md`).
 *
 * `markdown` is the **untrusted** body after the front matter, exactly as written. It is never
 * rendered directly: it goes through the rich-text pipeline (`@pwp/core/richtext`, ADR 0002),
 * which sanitizes it with the allow-list.
 */
export interface ContentPage {
  readonly frontMatter: PageFrontMatter;
  readonly markdown: string;
}

/**
 * A tenant asset found by {@link ContentSource.resolveAsset}. Holds no absolute path, so the
 * location of tenant files never leaks into build output or errors.
 */
export interface ResolvedAsset {
  /** The validated `AssetRef`, e.g. `assets/hero.jpg`. */
  readonly ref: string;
  /** From the extension allow-list of `@pwp/schema/primitives`, e.g. `image/jpeg`, `font/woff2`. */
  readonly contentType: string;
  /** Size in bytes, so the build can enforce asset size limits before reading. */
  readonly byteLength: number;
  /** The file's bytes. Each call reads them again; callers cache if they need to. */
  read(): Promise<Uint8Array>;
}

/**
 * Read access to **one** tenant's content. See the module comment for scope, loader order and
 * result rules. All methods are read-only: a content source never writes tenant content.
 */
export interface ContentSource<M extends ContentModel = ContentModel> {
  /**
   * The slug of the tenant this source is bound to, for messages and logs. Informational only:
   * nothing is looked up by it.
   */
  readonly tenant: string;

  /** `site.config.yaml`, parsed with `parseSiteConfig` (two passes, ADR 0003). Required. */
  loadSiteConfig(): Promise<SiteConfigResult<M['siteConfig'], M['issue']>>;

  /**
   * `theme.yaml`, the tenant's token overrides. Theme files hold no visitor-facing text, so this
   * takes no context. `data: undefined` when the tenant has no `theme.yaml`.
   */
  loadTheme(): Promise<ContentResult<M['theme'] | undefined, M['issue']>>;

  /** `content/menu.yaml`, validated with `menuSchema(ctx)`. `undefined` when absent. */
  loadMenu(ctx: LocaleContext): Promise<ContentResult<M['menu'] | undefined, M['issue']>>;

  /** `content/hours.yaml`, validated with `hoursSchema(ctx)`. `undefined` when absent. */
  loadHours(ctx: LocaleContext): Promise<ContentResult<M['hours'] | undefined, M['issue']>>;

  /** `content/locations.yaml`, validated with `locationsSchema(ctx)`. `undefined` when absent. */
  loadLocations(ctx: LocaleContext): Promise<ContentResult<M['locations'] | undefined, M['issue']>>;

  /**
   * Every `content/pages/*.md` of the tenant, front matter validated with
   * `pageFrontMatterSchema(ctx)`. An empty list when there are none.
   *
   * Besides each file's own issues, the source reports these rules across files, each as an
   * issue in the file that breaks it:
   * - a `key` + `locale` pair appears in one file only (the later file, in file-name order, gets
   *   the issue at `['key']`);
   * - every `key` exists in every locale of `ctx.locales` (the issue goes to a file of that key,
   *   at `['locale']`, and names the missing locale).
   *
   * Pages are returned sorted by `key`, then by the order of `ctx.locales`, so output is stable.
   */
  loadPages(ctx: LocaleContext): Promise<ContentResult<readonly ContentPage[], M['issue']>>;

  /**
   * Finds one asset of this tenant.
   *
   * `ref` must be a valid `AssetRef` (`@pwp/schema/primitives`). The source validates it again
   * and never trusts the caller: anything that is not a valid `AssetRef`, does not exist, or
   * resolves outside this tenant's `assets/` folder (symlinks included) is an issue, never a
   * file. A bad reference gives exactly one issue, with `file` set to the tenant's `assets/`
   * folder (`tenants/<slug>/assets`) and `path` `[]`. Callers that know which content file and
   * key held the reference report it there instead, so the tenant sees where to fix it.
   */
  resolveAsset(ref: string): Promise<ContentResult<ResolvedAsset, M['issue']>>;
}
