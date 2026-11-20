# ADR 0001: Platform architecture, package boundaries and dependency rules

- Status: accepted
- Date: 2026-11-20
- Deciders: architect, security (foundation bootstrap, committed directly at the human's request; `docs/DECISIONS.md` #81)

## Context

One repository must turn validated tenant data (config, content, assets) into an isolated, static-first website per pizzeria, for 5 tenants in year 1 and 50 in year 3 (Q1.5). Tenants must not be able to run code, add dependencies, break other tenants or weaken security (PROMPT.md §1, §6). A team of agents works in parallel, so boundaries must be explicit, enforceable in CI and laid out so that two units of work rarely touch the same file (§13.3).

Scope after intake: Sweden only, `sv` + `en`, no payments, no VAT handling, no online ordering in v1 (`docs/DECISIONS.md` #32–#34, #56).

## Options considered

1. **Astro static output + small serverless functions, pnpm workspace of internal packages** (the intake default).
2. A single Next.js/SSR app routing tenants by domain. Rejected: larger runtime attack surface, shared process across tenants, more JavaScript shipped, against Q7.2 (one isolated deployment per tenant).
3. One repository per tenant with its own app. Rejected: violates the single dependency root, multiplies upgrades.

## Decision

Option 1.

### Packages

All packages are private workspace packages named `@pwp/<name>` (no registry publishing, Q2.3). Source is consumed directly (`exports` → `./src/index.ts`); no per-package build step until a package needs one.

| Package      | Responsibility                                                                                                                                                                                          | May import (`@pwp/*`)              |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `schema`     | Zod schemas for every tenant-facing shape: site config, theme tokens, menu, hours, locations, pages, section types/variants/props. **The contracts.**                                                   | none                               |
| `core`       | Pure TypeScript: opening hours and "open now" in `Europe/Stockholm` (DST, holidays, overnight hours), allergen mapping, i18n helpers, slugs, price formatting (SEK display only). No I/O, no framework. | `schema`                           |
| `tokens`     | Token schema → CSS custom properties (light/dark), WCAG 2.2 AA contrast gate.                                                                                                                           | `schema`                           |
| `themes`     | Three starter themes: token sets, self-hosted WOFF2 fonts with licenses, image treatments. One folder per theme.                                                                                        | `schema`, `tokens`                 |
| `ui`         | Astro components and islands. One folder per component, auto-discovered.                                                                                                                                | `schema`, `tokens`, `core`         |
| `adapters`   | Interfaces (`src/interfaces/`, owned by architect) and implementations (`src/<adapter>/`): email, webhook, analytics, maps, storage, CMS. Mock adapter first, always the default in dev/test.           | `schema`, `core`                   |
| `functions`  | Serverless handlers (contact, catering, reservation request). Validated with the shared schemas, size-limited, rate-limited, CSRF-protected.                                                            | `schema`, `core`, `adapters`       |
| `cli`        | The `pwp` compiler: `new`, `validate`, `dev`, `build`, `audit`, `preview-themes`. Commands auto-discovered from `src/commands/<name>/`. Enforces build isolation.                                       | all of the above                   |
| `playground` | Renders component × variant × theme for development and visual regression.                                                                                                                              | `schema`, `tokens`, `themes`, `ui` |

`ui` may never import `functions` or `adapters`; client code never sees server code. The machine-readable form of this table is `scripts/boundaries.json`, checked by `pnpm check-boundaries` in CI. It also rejects relative imports that leave a package, and any import of `tenants/` from code.

### Tenants

`tenants/<slug>/` holds **data only**: `site.config.yaml`, `theme.yaml`, `content/*.yaml`, `content/pages/*.md`, `assets/` (JPEG/PNG/WebP/AVIF images, WOFF2 fonts). No SVG until a sanitizer lands (security decision). `tenants/` is not a workspace package. `pnpm tenant-guard` enforces this: forbidden package/lock/config files, file-type allow-list, no symlinks, and no scripts, raw HTML embeds, event handlers, `javascript:`/`data:`/`http:` URLs, external scripts/styles/fonts or module syntax in YAML/Markdown.

Config refers to platform things **by name only**: section `type`, `variant`, theme name, adapter name. Unknown keys are errors.

### Composition and discovery

A page is an ordered list of sections (`type`, `variant`, `props`) validated against `@pwp/schema` at build time. Components, variants, themes, adapters and CLI commands are discovered by folder convention (glob/codegen at build time). **No hand-edited central registries or barrel files**, so adding a unit never edits a shared index.

Each schema that a component consumes lives next to the section-type definition in `packages/schema/src/sections/<type>.ts`; a component's own `schema.ts` re-exports it and adds nothing.

### Build and isolation

`pwp build <slug>` builds one tenant into `dist/<slug>/` in its own process with:

- read access only to `tenants/<slug>/` and `packages/`; any attempt to resolve another tenant path fails the build (tested);
- only that tenant's environment variables (`PWP_<SLUG>_*` mapped to unprefixed names);
- per-tenant security headers and a strict CSP generated from the enabled adapters (no `unsafe-inline`, no `unsafe-eval`; hashes for any inline script).

Output is provider-agnostic static files plus function bundles; deployment sits behind a deploy adapter (Q7.1).

### Tooling

Node 26 (Active LTS since 2026-10-28), pnpm 10 workspaces, Turborepo, TypeScript strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), ESLint flat config with typescript-eslint, Prettier, Vitest, Playwright. Versions pinned exactly; `.npmrc` sets `save-exact`, `engine-strict`, `strict-peer-dependencies`. Dependency build scripts are blocked (`onlyBuiltDependencies: []`). See `docs/DEPENDENCIES.md`.

## Consequences

- Strong isolation and a small runtime surface; most pages ship zero JavaScript.
- Boundaries and tenant rules are enforced by dependency-free Node scripts that run even before `pnpm install`, so they can't be bypassed by a broken install.
- Auto-discovery means a component, theme or command can be added by one agent without touching shared files; the cost is a codegen step in the CLI (M5).
- Consuming TypeScript source across packages keeps the setup simple; if build times grow, packages get their own build step (new ADR).
- Island framework (Preact vs Solid) and the sanitizer library are open: each needs a `type:dependency` issue approved by architect and security.
