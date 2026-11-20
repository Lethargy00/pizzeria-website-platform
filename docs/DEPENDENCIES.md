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

Notes:

- `typescript` stays below 5.9 because `typescript-eslint` 8.35 supports `<5.9.0`; upgrade both together.
- The M1 versions were chosen offline during the foundation bootstrap (`docs/DECISIONS.md` #81). They are known releases, not the newest ones. Dependabot opens upgrade PRs weekly; each goes through the normal dependency review.
- What agent sessions can verify (checked 2026-11-20). Agents can reach `registry.npmjs.org`, so these work: `npm view <pkg>@<version>` for registry metadata and integrity, and `pnpm audit` against `pnpm-lock.yaml`, which reported the six findings listed under zod below. Agents cannot reach `api.github.com` (the GitHub advisory API returns 403), `api.osv.dev` (the proxy refuses the tunnel) or `tuf-repo-cdn.sigstore.dev`, so `npm audit signatures` fails with "Failed to download". Note that `npm audit` needs a `package-lock.json` and does not read `pnpm-lock.yaml`. Treat `pnpm audit` as the advisory check, and run the signature and provenance check from a machine that can reach those hosts.
- Guard scripts in `scripts/` (tenant-guard, boundaries, review-gate, touches-guard, licenses) use only Node built-ins on purpose.
- Override: `tinypool` forced to 2.1.2 (CVE-2026-104848, CVE-2026-104849) in `pnpm-workspace.yaml`.
- Planned, each needing its own `type:dependency` issue: `astro`, an island framework (Preact or Solid), an HTML/Markdown sanitizer, an image pipeline (M5), `@axe-core/playwright` and Lighthouse CI (M4).

### zod (approved in #18)

- Runtime `dependencies` of `@pwp/schema` only; no other `package.json` declares it. Other packages get schemas and inferred types from `@pwp/schema`. Contracts use `import { z } from 'zod'`, never `astro/zod`.
- Approved by `architect` and `security` on #18. License MIT, 0 dependencies, no install scripts, npm SLSA provenance. Published 2026-10-12.
- `pnpm audit` on this change: no advisories for `zod`. The six existing findings (`turbo` ×2, `vitest`, `@vitest/mocker` ×2, `minimatch`) are unrelated to this change.
- Binding conditions for contracts (#22 and later): tenant-input and request-body schemas use `strictObject` (unknown keys are errors); `SafeUrl` needs an explicit scheme allow-list because `z.url()` accepts `javascript:`; strings and arrays carry `.max()` limits.
- Client-side validation in islands (M7) is a separate decision against the 50 KB budget (likely `zod/mini`).
