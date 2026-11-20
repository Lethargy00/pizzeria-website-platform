# Approved dependencies

Every platform dependency, with its purpose. Versions are pinned exactly in `package.json`. Adding or upgrading one needs a `type:dependency` issue approved by `architect` and `security` (PROMPT.md §6). Owner: `platform`.

The M1 tooling set below was approved as part of the foundation bootstrap, committed directly at the human's request (`docs/DECISIONS.md` #81). All are dev-only: none ships to visitors.

| Package             | Version | Purpose                                | License    |
| ------------------- | ------- | -------------------------------------- | ---------- |
| `typescript`        | 5.8.3   | Strict type checking                   | Apache-2.0 |
| `@types/node`       | 24.0.10 | Node API types for configs and scripts | MIT        |
| `eslint`            | 9.30.0  | Linting                                | MIT        |
| `@eslint/js`        | 9.30.0  | ESLint recommended rules               | MIT        |
| `typescript-eslint` | 8.35.0  | TypeScript lint rules and parser       | MIT        |
| `prettier`          | 3.6.2   | Formatting                             | MIT        |
| `vitest`            | 3.2.4   | Unit and component tests               | MIT        |
| `@playwright/test`  | 1.55.1  | E2E, visual regression, keyboard tests | Apache-2.0 |
| `turbo`             | 2.5.4   | Task runner and caching                | MIT        |

Notes:

- `typescript` stays below 5.9 because `typescript-eslint` 8.35 supports `<5.9.0`; upgrade both together.
- These versions were chosen offline (agent sessions can't reach the npm registry) and are known releases, not the newest ones. Dependabot opens upgrade PRs weekly; each goes through the normal dependency review.
- Guard scripts in `scripts/` (tenant-guard, boundaries, review-gate, touches-guard, licenses) use only Node built-ins on purpose.
- Override: `tinypool` forced to 2.1.2 (CVE-2026-104848, CVE-2026-104849) in `pnpm-workspace.yaml`.
- Planned, each needing its own `type:dependency` issue: `astro`, `zod` (M2), an island framework (Preact or Solid), an HTML/Markdown sanitizer, an image pipeline (M5), `@axe-core/playwright` and Lighthouse CI (M4).
