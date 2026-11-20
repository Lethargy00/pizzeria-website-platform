# Approved dependencies

Every platform dependency, with its purpose. Versions are pinned exactly in `package.json`. Adding or upgrading one needs a `type:dependency` issue approved by `architect` and `security` (PROMPT.md §6). Owner: `platform`.

The M1 tooling set below was approved as part of the foundation bootstrap, committed directly at the human's request (`docs/DECISIONS.md` #81). All are dev-only: none ships to visitors.

| Package             | Version | Purpose                                        | License    |
| ------------------- | ------- | ---------------------------------------------- | ---------- |
| `typescript`        | 5.8.3   | Strict type checking                           | Apache-2.0 |
| `@types/node`       | 24.0.10 | Node API types for configs and scripts         | MIT        |
| `eslint`            | 9.30.0  | Linting                                        | MIT        |
| `@eslint/js`        | 9.30.0  | ESLint recommended rules                       | MIT        |
| `typescript-eslint` | 8.35.0  | TypeScript lint rules and parser               | MIT        |
| `prettier`          | 3.6.2   | Formatting                                     | MIT        |
| `vitest`            | 4.1.7   | Unit and component tests                       | MIT        |
| `@playwright/test`  | 1.55.1  | E2E, visual regression, keyboard tests         | Apache-2.0 |
| `turbo`             | 2.5.4   | Task runner and caching                        | MIT        |
| `zod`               | 4.6.7   | Runtime schema validation (`@pwp/schema` only) | MIT        |
| `yaml`              | 2.9.1   | YAML parsing with source ranges (`@pwp/cli`)   | ISC        |

Notes:

- `typescript` stays below 5.9 because `typescript-eslint` 8.35 supports `<5.9.0`; upgrade both together.
- These versions were chosen offline (agent sessions can't reach the npm registry) and are known releases, not the newest ones. Dependabot opens upgrade PRs weekly; each goes through the normal dependency review.
- Guard scripts in `scripts/` (tenant-guard, boundaries, review-gate, touches-guard, licenses) use only Node built-ins on purpose.
- Override: `tinypool` forced to 2.1.2 (CVE-2026-104848, CVE-2026-104849) in `pnpm-workspace.yaml`.
- Planned, each needing its own `type:dependency` issue: `astro`, an island framework (Preact or Solid), an HTML/Markdown sanitizer, an image pipeline (M5), `@axe-core/playwright` and Lighthouse CI (M4).

### zod (approved in #18)

- Runtime `dependencies` of `@pwp/schema` only; no other `package.json` declares it. Other packages get schemas and inferred types from `@pwp/schema`. Contracts use `import { z } from 'zod'`, never `astro/zod`.
- Approved by `architect` and `security` on #18. License MIT, 0 dependencies, no install scripts, npm SLSA provenance. Published 2026-10-12.
- `pnpm audit` on this change: no advisories for `zod`. The six existing findings (`turbo`, `vitest`, `@vitest/mocker`, `minimatch`) are unrelated to this change.
- Binding conditions for contracts (#22 and later): tenant-input and request-body schemas use `strictObject` (unknown keys are errors); `SafeUrl` needs an explicit scheme allow-list because `z.url()` accepts `javascript:`; strings and arrays carry `.max()` limits.
- Client-side validation in islands (M7) is a separate decision against the 50 KB budget (likely `zod/mini`).

### yaml (approved in #19)

- Runtime `dependencies` of `@pwp/cli`; `devDependencies` of `@pwp/schema` (YAML fixtures in `*.test.ts` only, never imported from `packages/schema/src/` outside tests, so `@pwp/schema` stays format-agnostic for the CMS `ContentSource`, #28). No other `package.json` declares it. `@pwp/core` does no file formats.
- Approved by `architect` and `security` on #19; placement and options recorded in ADR 0002. License ISC, 0 dependencies, no install scripts (the only script named like one, `docs:install`, is repo-only). Published 2026-09-11. No npm provenance attestation; security accepted that because of the zero-dependency footprint and the integrity hash in the lockfile. Do not use the `3.0.0-*` prereleases.
- Advisories at approval (2026-11-20): `npm audit` reports none for 2.9.1. CVE-2023-2251 (uncaught exception, below 2.2.2) does not apply.
- `astro@7.4.7` (#20) resolves `yaml` to 2.9.1 as well, so there is one copy.
- Binding conditions (ADR 0002, implemented by `parseTenantYaml` in #53, the only call site):
  - `parseDocument(src, { version: '1.2', schema: 'core', merge: false, strict: true, uniqueKeys: true, stringKeys: true, prettyErrors: true, lineCounter, customTags: [] })`, then `doc.toJS({ maxAliasCount: 0 })` (no anchors or aliases in tenant content).
  - `doc.errors` and `doc.warnings` both count as validation errors (unknown and `!!js/...` tags only raise a warning).
  - Never register custom tags, use the `yaml-1.1` schema or a `reviver`. The package's `yaml` bin is not used by any script.
  - File size is checked before parsing (T15); the result goes straight into the `strictObject` schemas.
  - Invalid fixtures: alias bomb, unknown and `!!js` tags, duplicate keys, a `__proto__` key, a merge key.
