# ADR 0003: Schema export convention and locale context

- Status: accepted
- Date: 2026-11-20
- Deciders: architect (issue #102, from architect-8's review of PR #99 / #22)

## Context

PR #99 (#22) added `@pwp/schema/primitives` and made two choices that every later contract builds on:

1. `packages/schema/package.json` exports `"./*": "./src/*/index.ts"`, while `@pwp/core` and `@pwp/adapters` (PR #91) list each subpath by hand.
2. Text that visitors see is validated with `localizedStringFor(locales)`, so the schema is built for one tenant's enabled locales (`LocaleContext`). There is no global locale state.

The second choice leaves an open point. `SiteConfig` (#52) contains both the tenant's `locales` and localized texts (`name`, page titles), so it cannot be built from a context that it defines itself. Two edge cases were also left open: `localizedStringFor([])` returns a schema that accepts `{}`, and the output type is `{ sv?: string; en?: string }` even for enabled locales.

This ADR settles these points before #52 starts. It also binds #24 (sections), #25 to #28 (the domain schemas and the CMS `ContentSource`) and every later schema with visitor-facing text.

## Options considered

### Exports

- **Explicit subpaths in every package.** Rejected for `@pwp/schema`. Each schema folder is its own parallel issue whose Touches cover only that folder (#23 `errors/**`, #24 `sections/**`, #25 `menu/**`, #34 `theme/**`, #52 `site-config/**`, #64 `adapters/**`). With explicit entries, every one of them would also edit `package.json`. That breaks the non-overlapping-Touches rule and makes `package.json` the hand-edited central registry that ADR 0001 forbids.
- **The wildcard in every package.** Rejected for `@pwp/core` and `@pwp/adapters`. Their public surface is chosen on purpose: adapter implementations are not public API, and `./richtext` is separate so that the pipeline stays out of client bundles (ADR 0002). A wildcard would publish every folder by accident.
- **Wildcard in `@pwp/schema` only, explicit subpaths everywhere else** (chosen).

### How `SiteConfig` gets its locales

- **(a) Two passes.** First validate only `locales` and `defaultLocale`, then build `siteConfigSchema({ locales })` and validate the whole document (chosen).
- **(b) A context-free `LocalizedString` everywhere in `SiteConfig`, plus a `superRefine` that cross-checks every localized field against `locales`.** Rejected. It is a second code path that must raise the same `missing_locale` issue at the same path by hand, and it must find every localized field itself. Section props (#24) are factories of a `LocaleContext`, so they could not be reused inside `SiteConfig` without a context anyway.
- **(c) Module-level or global locale state** set by the loader. Rejected. It breaks the purity of schemas, makes test order matter, and is unsafe when several tenants are validated in one process (tests, `pwp audit`).

### Empty locale list

- **Accept `[]` and return a schema that accepts `{}`** (the current behaviour). Rejected. It fails open: a bug that loses the locales would make every localized text pass as empty.
- **Throw at schema construction** (chosen).

### Output type of a localized text

- **A generic `localizedStringFor<L extends LocaleCode>(locales: readonly L[])` with output `Record<L, string>`.** Rejected. The locales come from tenant data at runtime, so `L` is always `LocaleCode` in practice and the type gains nothing. The generic would also spread through every factory and through the `SiteConfig` type.
- **`Record<LocaleCode, string>`.** Rejected. It is false for a tenant that enabled one locale.
- **`Partial<Record<LocaleCode, string>>` (`{ sv?: string; en?: string }`), read only through one helper** (chosen).

## Decision

### 1. Export convention

- **`@pwp/schema` only** uses `".": "./src/index.ts"` and `"./*": "./src/*/index.ts"`. A new schema folder `src/<name>/` with an `index.ts` is published as `@pwp/schema/<name>` with no edit to a shared file.
- **Every other package keeps explicit subpaths** in `exports` and must not copy the wildcard. Adding a subpath there is a deliberate API change in that package's own issue.
- **The root `@pwp/schema` module never re-exports a folder.** It holds `PACKAGE_NAME` and the sanctioned `z` (ADR 0002), nothing else.
- **What is public.** Exactly the files that match `src/*/index.ts`. Because Node's `*` in `exports` matches across `/`, this includes **nested** index files: `src/sections/hero/index.ts` would be published as `@pwp/schema/sections/hero`. Other files (`src/primitives/safe-url.ts`, `fixtures.ts`, tests) cannot be imported from outside the package. Therefore:
  - Do not create a nested folder with its own `index.ts` unless it is meant to be a public subpath. Use flat files (`src/sections/<type>.ts`, as ADR 0001 says) or a folder without `index.ts`.
  - A folder name is public API. Renaming or removing a folder, or removing an export from its `index.ts`, is a `type:contract` change.
  - `@pwp/schema/sections` is served by the generated `src/sections/index.ts` (#24). Component `schema.ts` files import from `@pwp/schema/sections`, never from a per-type file.
  - Fixtures that other packages need (for example the #51 harness) are exposed on purpose through their own folder (for example `src/fixtures/index.ts`) in the issue that needs them, never through a deep import.
- **Inside `@pwp/schema`**, a folder imports another folder only through that folder's `index.ts` (`../primitives/index.js`), never a deep file. The internal surface then matches the public one.
- `pnpm check-boundaries` keys on the package name and ignores subpaths, so it needs no change.

### 2. The `LocaleContext` rule

Binding on every schema in `@pwp/schema` that contains text a visitor can see:

- The schema is a **pure factory** of a `LocaleContext`: `export function menuSchema(ctx: LocaleContext) { ... }`. Inside, every visitor-facing text uses `localizedStringFor(ctx.locales)`, and nested schemas receive the same `ctx`. Section props in #24 follow this too: `defineSection` takes `props` as `(ctx: LocaleContext) => schema`, and the generated union is itself a factory.
- **Naming.** Factories are camelCase with a `Schema` suffix (`menuSchema`, `siteConfigSchema`). Context-free schemas stay PascalCase constants (`Slug`, `SafeUrl`). Types are PascalCase and are inferred from the output: `export type Menu = z.output<ReturnType<typeof menuSchema>>`.
- Schemas with no visitor-facing text stay constants and take no context.
- **No global or module-level locale state.** Factories may not read anything outside their argument.
- The `LocaleContext` passed to a factory always comes from pass 1 of the site config (section 3). Nothing else builds one, except tests.
- The context-free `LocalizedString` is only for platform-owned defaults, where no tenant exists. Tenant content never uses it.
- `LocaleContext` stays `{ readonly locales: readonly LocaleCode[] }`. The default locale is not part of it, because schemas do not need it. Rendering gets `defaultLocale` from the validated `SiteConfig`.

### 3. `SiteConfig` is parsed in two passes

`@pwp/schema/site-config` (#52) exports these:

- `SiteLocales`: a `strictObject({ locales, defaultLocale })` with these rules:
  - `locales` is an array of `LocaleCode`, with at least 1 and at most `LOCALES.length` entries and no duplicates. A duplicate is an issue at its index.
  - `defaultLocale` is a `LocaleCode`. It is required in the file, and `pwp new` writes it.
  - `defaultLocale` must be in `locales`. Otherwise there is an issue at `['defaultLocale']`.
- `siteConfigSchema(ctx: LocaleContext)`: the full `strictObject` for the whole document. It contains `locales` and `defaultLocale` again, with the same rules, so the schema stands alone and its output is the complete config.
- `parseSiteConfig(input: unknown)`: the only entry point loaders use. Nobody hand-rolls the two passes.
  1. **Pass 1.** If `input` is a plain object, take only its `locales` and `defaultLocale` keys and validate them with `SiteLocales`. If it is not a plain object, validate `input` itself, so the type error is reported at the root. Picking the two keys means pass 1 needs no loose object and no `z.object()`; strictness is kept for pass 2.
  2. If pass 1 fails, stop and return its issues. Their paths (`['locales', 1]`, `['defaultLocale']`) are already relative to the document root, so they look the same as any other issue.
  3. **Pass 2.** Build `ctx = { locales }` from the pass-1 output and validate the whole `input` with `siteConfigSchema(ctx)`.
  4. It returns `{ success: true, data, context }` or `{ success: false, error, context? }`. `error` is a `ZodError` in both passes, so the error mapping (#23) has one shape to handle. `context` is present whenever pass 1 succeeded, even if pass 2 failed.
- **Loader order (#53, #54 and the CLI).** Parse the site config first. If `context` is present, validate every other tenant file (menu, hours, locations, pages) with that context, even when pass 2 failed, so the tenant sees all errors in one run. If pass 1 failed, report only those issues and skip the other files with one clear message: fix `locales` and `defaultLocale` first. The CMS `ContentSource` (#28) follows the same order.

### 4. `localizedStringFor([])` throws

`localizedStringFor` throws a `TypeError` at **schema construction** when the list is empty or contains a value that is not in `LOCALES`. Duplicates are ignored. This is a programmer error, not a tenant error: tenant input cannot reach it, because pass 1 rejects an empty or unknown `locales`. So it is a thrown error and not a Zod issue, and the contract fails closed. The change is made in `packages/schema/src/primitives/locale.ts`, with a test, as a follow-up. It is best folded into #103, which already touches `packages/schema/src/primitives/**`. It is additive for every valid caller.

### 5. Localized texts are typed as optional in the output

- The output type stays `LocalizedString = Partial<Record<LocaleCode, string>>`, that is `{ sv?: string; en?: string }`. With `exactOptionalPropertyTypes` the key is absent, never `undefined`.
- After validation, every enabled locale is present. A missing value is therefore only possible when code asks for a locale the tenant did not enable.
- Code never indexes `text[locale]` directly. It reads localized text only through one helper in `@pwp/core` i18n: `localize(text, locale, defaultLocale): string`. It returns `text[locale]`, otherwise `text[defaultLocale]`, and throws if both are missing. A build then fails instead of rendering empty text. Components, `@pwp/core` and `functions` use this helper.
- Exported types are **output** types (`z.output` / `z.infer`). Where input differs (for example `PriceSEK`: kronor in, öre out), editor JSON Schema uses `z.toJSONSchema(schema, { io: 'input' })` and fixtures are written in input form, as architect-8 noted on PR #99.

## Consequences

- New schema folders need no edit to shared files. The cost: any `src/<x>/index.ts`, nested or not, is public the moment it exists. Reviewers check new `index.ts` files in `@pwp/schema` as public API changes.
- `@pwp/core` and `@pwp/adapters` keep a curated surface. The rich-text isolation from ADR 0002 is unaffected.
- One code path and one error shape for every localized field, the site config included. The price is a second, very small validation pass and a `parseSiteConfig` entry point that loaders must use.
- Tenants see all errors in one run, except when `locales` itself is broken.
- Every schema with visitor-facing text is a function. Tests and the playground (#51) build a `LocaleContext` explicitly, for example `{ locales: ['sv', 'en'] }`.
- An empty locale list now fails loudly at construction instead of silently accepting `{}`.
- Consumers must go through `localize`. A direct `text[locale]` is a review finding. A lint rule can be added later if this proves to be a problem.
- Changing any rule in this ADR needs a `type:contract` issue and an update to this ADR.

## Follow-ups (Orchestrator to file or link)

1. `localizedStringFor` throws on an empty or unknown locale list, with a test. Touches: `packages/schema/src/primitives/**`. Best folded into #103.
2. `localize(text, locale, defaultLocale)` in the `@pwp/core` i18n helpers, with tests for fallback and the throw. Add it to the existing core i18n issue, or file a new one.
3. #52 implements `SiteLocales`, `siteConfigSchema(ctx)` and `parseSiteConfig` as described in section 3. Its acceptance criteria need fixtures for pass-1 failures: empty, duplicate and unknown `locales`, `defaultLocale` not in `locales`, and a root that is not an object.
4. #24 takes section `props` as a factory of `LocaleContext`. #25 to #28 build their schemas as factories wherever they hold visitor-facing text. #53 and #54 call `parseSiteConfig` and follow the loader order.

## Links

- #102 (this ADR), #22 / PR #99 (primitives, export convention), architect-8's review on PR #99
- #23, #24, #25, #26, #27, #28, #34, #51, #52, #53, #54, #64, #103
- ADR 0001 (packages, no central registries), ADR 0002 (zod placement, `./richtext` isolation)
