# ADR 0002: Runtime dependency placement and the single rich-text chokepoint

- Status: accepted
- Date: 2026-11-20
- Deciders: architect, security (architect and security approvals on #18, #19, #20, #21)

## Context

ADR 0001 left the sanitizer library open and `docs/DEPENDENCIES.md` lists Astro and Zod as "planned". The approvals on #18 (zod), #19 (yaml), #20 (astro) and #21 (rich-text pipeline) made decisions that later agents need to find in `docs/adr/`, not only in issue comments. This ADR records which package owns which runtime dependency, which paths are the only ones allowed to use it, and the security conditions that shape that placement. Where architect and security first differed, the reconciled ANSWER comments on those issues are the source (Astro pin: the architect's `7.4.7`; sanitizer ordering: the architect's "nothing after the sanitizer"; YAML options: the union of both lists).

The rules in ADR 0001 still apply: tenants import nothing, only the platform has dependencies, and every new dependency needs an approved `type:dependency` issue.

## Options considered

- **Declare shared libraries wherever they are used** (every package lists `zod`, `yaml`, and so on). Rejected: several copies and versions can drift, and nothing stops a package from bypassing the shared helper.
- **Use the copies bundled with Astro** (`astro/zod`, Astro's Markdown and content collections). Rejected: two validators, a Markdown engine (`@astrojs/markdown-satteri`, 0.x) that is not the sanitizer chokepoint, and contracts tied to a framework version.
- **Sanitizer: `sanitize-html` or DOMPurify.** Rejected: string-based (an htmlparser2 round trip, larger tree) or needs jsdom at build time. A hand-written sanitizer is rejected outright.
- **One owner per dependency, one entry point per capability** (chosen).

## Decision

### Placement

| Dependency                                                                                                          | Declared by (exact pin)                                                           | Notes                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `zod@4.6.7`                                                                                                         | `@pwp/schema` `dependencies` only                                                 | #18                                                                                                                                 |
| `yaml@2.9.1`                                                                                                        | `@pwp/cli` `dependencies`; `@pwp/schema` `devDependencies` (test fixtures only)   | #19. Do not use the `3.0.0-*` prereleases.                                                                                          |
| `astro@7.4.7`                                                                                                       | `@pwp/ui`, `@pwp/cli`, `playground` `dependencies`, all at the same exact version | #20. Dependabot groups the three so they move together.                                                                             |
| `unified@11.0.5`, `remark-parse@11.0.0`, `remark-rehype@11.1.2`, `rehype-sanitize@6.0.0`, `rehype-stringify@10.0.1` | `@pwp/core` `dependencies`                                                        | #21. Transitive: `hast-util-sanitize@5.0.2`, `mdast-util-to-hast@13.2.2` (>= 13.2.1, the fix for the unsanitized-`class` advisory). |

Exact pins only (no `^`/`~`). Lockfile changes come from the lockfile workflow, and lockfile-touching dependency issues land one at a time.

### Release-age rule

A new pin uses a version that has been published for at least 14 days, unless security asks for a newer one to fix a vulnerability. This is why Astro is `7.4.7` (2026-11-05) and not `7.4.13`; later patches arrive through Dependabot once they are two weeks old. Security's non-blocking note stands: if a pin lands long after approval, re-check `npm audit` against the newest eligible patch.

### Zod: one validator, one place

- Only `@pwp/schema` declares `zod`. Other packages get schemas, inferred types and, if needed, `z` through a re-export from `@pwp/schema` (scope of #22). pnpm's strict layout makes an undeclared `import 'zod'` fail.
- Contracts use `import { z } from 'zod'`. Never `astro/zod` or the `z` from `astro:content`.
- Tenant-input and request-body schemas use `strictObject` (the #22 helper), never `z.object()`, which silently strips unknown keys. Strings and arrays carry `.max()` limits (T5, T15).
- `SafeUrl` (#22) does not rely on `z.url()` (it accepts `javascript:`). It has an explicit scheme allow-list (`https:`, `mailto:`, `tel:`) and rejects `//` and `\\` prefixes.
- Client-side validation in islands (M7) is a separate decision against the 50 KB budget (likely `zod/mini`).

### YAML: one parse function, owned by the CLI

`@pwp/schema` validates plain JS values and stays format-agnostic (this keeps the CMS `ContentSource`, #28, possible). `@pwp/core` does no file formats. `@pwp/cli` provides a single `parseTenantYaml(source, file)` helper (#53) used by every loader; no other call site passes its own options.

- `parseDocument(src, { version: '1.2', schema: 'core', merge: false, strict: true, uniqueKeys: true, stringKeys: true, prettyErrors: true, lineCounter, customTags: [] })`, then `doc.toJS({ maxAliasCount: 0 })`. Anchors and aliases are rejected outright.
- `doc.errors` and `doc.warnings` both count as validation errors (a `!!js/...` or unknown tag only raises a warning and would otherwise pass as a string).
- Never register custom tags, use the `yaml-1.1` schema or a `reviver`. The package's `yaml` bin is not used.
- File size is checked before parsing (T15); the result goes straight into the `strictObject` schemas.
- Invalid fixtures: alias bomb, unknown and `!!js` tags, duplicate keys, a `__proto__` key, a merge key.
- `yaml` is never a runtime import of `@pwp/schema` (the fixture harness, #51, may use it in tests only).

### Astro: core only, static only

- No `sharp`: `ignoredOptionalDependencies: [sharp]` in `pnpm-workspace.yaml`, and the lockfile has no `sharp` or `@img/*` entries (the libvips binaries are LGPL-3.0-or-later). Astro uses the passthrough image service until the M5 image-pipeline `type:dependency` issue decides this with security.
- `lightningcss` and `lightningcss-*` are MPL-2.0 and required through vite. `scripts/check-licenses.mjs` gets a **package-scoped** exception for exactly those names, with a comment pointing to #20. MPL-2.0 is not allowed globally. Security accepted this because the files are used unmodified, at build time only, and are not shipped to visitors.
- No `@astrojs/markdown-remark`, no adapters, no `@astrojs/*` integrations without their own `type:dependency` issue. `onlyBuiltDependencies: []` stays; no new entry is approved (`fsevents` stays blocked).
- Telemetry is off: `ASTRO_TELEMETRY_DISABLED=1` in every workflow that runs Astro, in the environment `pwp` passes to Astro (build, dev, preview) and in the playground, and it is documented for local development. A build makes no outbound network calls; the CLI enforces it (#54, #55) and #46 tests it.
- No runtime third-party origins (T8): no Astro Fonts API remote providers (fonts are self-hosted), `image.domains` and `image.remotePatterns` stay empty, static output only, `experimental.*` flags need security review. The dev server is never started with `--host`.
- Tenant Markdown and content never go through Astro's built-in Markdown (`@astrojs/markdown-satteri`) or content-collection rendering. Astro 7 no longer uses unified internally, so the sanitizer decision stands on its own merits.

### Rich text: the single chokepoint

Markdown becomes HTML **only** through `renderMarkdown` in `@pwp/core/richtext` (#47).

- It is a subpath export (`"./richtext": "./src/richtext/index.ts"`) and is **never re-exported** from the `@pwp/core` root, so an island importing `@pwp/core` formatting helpers cannot pull the pipeline into a client bundle. The pipeline is pure (no I/O).
- Fixed pipeline order:
  1. `remark-parse`
  2. `remark-rehype` with no `allowDangerousHtml` and no `passThrough`
  3. our own transforms, all **before** the sanitizer: a `SafeUrl` check on every `href` (a failing URL is removed and reported as a validation error; this catches protocol-relative `//` links that `hast-util-sanitize` treats as relative), an `AssetRef` check on `src` only if images are ever allowed, and `rel="noopener noreferrer"` on links
  4. `rehype-sanitize(schema)` as the **last** transform
  5. `rehype-stringify`

  **Nothing runs after the sanitizer.** `rehype-raw` and `allowDangerousHtml` are never used.

- The allow-list schema is our own, never `defaultSchema` as-is: `protocols.href = ['https','mailto','tel']`; tags limited to `p`, `h2`-`h4`, `ul`, `ol`, `li`, `strong`, `em`, `a`, `blockquote`, `code`, `pre`, `br`, `hr`; no `id`, `name`, `class` or `style`; no `input`, `details`, `summary` or `img` by default; `rel` allowed on `a` only. Security approves the final schema in #47.
- Input size is checked before parsing (T15). No extra syntax plugins (`remark-gfm`, directives, MDX) without a `type:dependency` issue.
- Output is the branded `SafeHtml` string type (the brand lives in `@pwp/schema`, scope of #22). UI components that use `set:html` accept only `SafeHtml`; a lint or grep check for other `set:html` uses is welcome.
- The XSS corpus in #47 includes protocol-relative link and image cases (`//evil.example/x`, `//evil.example/p.png`), `javascript:` in mixed case and entity-encoded forms, `data:`, `http:`, reference-style `vbscript:` links, and a test that tenant Markdown cannot set `rel` itself.

### Enforcement (binding on later PRs)

pnpm's strict layout only stops packages that do not declare a dependency; it does not stop another file in `@pwp/core`, or a package that later gets `unified` or `rehype-*`, from rendering Markdown around `renderMarkdown`. These mechanisms close that gap. Until a mechanism exists, its follow-up issue is a blocker for merging any PR that adds a Markdown or HTML sink. The follow-up issues are #79, #80 and #81, plus notes on #22 and #47.

| Rule                                                                                                                                                                                                                                                                                                              | Mechanism                                                                                                                                                                                                                                                     | Follow-up issue, owner role                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| (a) No Markdown or sanitizer imports outside `packages/core/src/richtext/**`: `unified`, `remark-*`, `rehype-*`, `hast-*`, `mdast-*`, `marked`, `markdown-it`, `sanitize-html`, `dompurify`, `@astrojs/markdown-*`, `astro:content` `render()` / `<Content />`, and `.md`/`.mdx` page imports for tenant content. | A rule in `scripts/boundaries.json` / `pnpm check-boundaries` (dependency-free Node, runs in CI before install).                                                                                                                                              | #79 "Boundary rule: Markdown and sanitizer imports only in core/richtext", platform |
| (b) Every `set:html`, `innerHTML`, `outerHTML`, `insertAdjacentHTML` and `dangerouslySetInnerHTML` use accepts only a `SafeHtml` value.                                                                                                                                                                           | A **required** CI check: a dependency-free script in `pnpm tenant-guard`'s family (grep over `packages/**` and `playground/`) failing on any sink whose argument is not `SafeHtml`-typed, plus a typecheck-level test that a plain `string` is rejected.      | #80 "Required check: HTML sinks accept only SafeHtml", platform                     |
| (c) Security review is required for any change under `packages/core/src/richtext/**`, the `./richtext` export in `packages/core/package.json`, the sanitize schema, and the boundary rule from (a) and the check from (b) themselves.                                                                             | `.github/CODEOWNERS` entries for those paths owned by the security role, and a row for them in the review matrix (`review:security`).                                                                                                                         | #81 "CODEOWNERS and review-matrix coverage for the richtext path", orchestrator     |
| (d) Only `renderMarkdown` may construct `SafeHtml`.                                                                                                                                                                                                                                                               | The brand constructor is module-private to `packages/core/src/richtext/` and not exported for general use (the `SafeHtml` type is exported from `@pwp/schema`, the constructor is not); the check in (b) fails on any cast to `SafeHtml` outside that folder. | Covered by #22 (type) and #47 (constructor); #80 adds the cast check                |
| (e) `rehype-sanitize` is the last transformer.                                                                                                                                                                                                                                                                    | A CI test in `packages/core` that runs the #47 XSS corpus against `renderMarkdown` and asserts the sanitizer is the last plugin in the pipeline, so a reordering fails.                                                                                       | Covered by #47 (test requirement); owner platform                                   |
| (f) `rehype-raw` and `allowDangerousHtml` are banned repo-wide.                                                                                                                                                                                                                                                   | The same script as (a) greps the whole repo (outside `node_modules` and this ADR) and fails on either token.                                                                                                                                                  | Folded into #79, platform                                                           |

Changing or weakening any rule in this subsection needs security approval and an update to this ADR. The `docs/DEPENDENCIES.md` entries for the pins in this ADR remain required in the implementing PRs (#18-#21).

## Consequences

- One validator, one YAML loader and one sanitizer chokepoint, enforced by the mechanisms in the Enforcement subsection above and by pnpm's strict resolution.
- Client bundles cannot accidentally include build-time pipelines (the `@pwp/core` root stays small).
- The CMS path stays open because `@pwp/schema` takes plain values.
- The lockfile stays free of LGPL packages, and the only license exception is package-scoped. The image pipeline (and with it `sharp`/libvips) and the island framework remain open, each needing its own `type:dependency` issue.
- Astro runs about two weeks behind `latest`; staying current depends on Dependabot grouping.
- Changing any placement or option above needs a new ADR or a `type:contract` issue.

## Links

- #18 zod, #19 yaml, #20 astro, #21 rich-text pipeline
- Follow-ups: #79 (boundary rule), #80 (HTML sink check), #81 (CODEOWNERS and review matrix), #22 (primitives, `SafeHtml`, `SafeUrl`), #47 (`renderMarkdown`), #53 (`parseTenantYaml`), #54, #55 and #46 (telemetry enforcement and tests), #28 (`ContentSource`)
- Implementing PR for #18: #73
- ADR 0001
