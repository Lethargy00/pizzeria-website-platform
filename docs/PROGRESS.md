# Progress

Updated by `orchestrator` every loop.

## 2026-11-20

- Phase 0 (intake) done: `docs/DECISIONS.md`. Scope cut: no payments, no VAT, online ordering moved to Later.
- Phase 1 setup done: `AGENTS.md`, role files, issue/PR templates, 81 labels, milestones M1–M9 + Later.
- **M1 Foundation built** (committed directly to `main` at the human's request, DECISIONS #81):
  - pnpm workspace with 8 `@pwp/*` packages + playground, Turborepo, strict TS, ESLint, Prettier, Vitest, Playwright, Node 26.
  - Dependency-free guards with tests: `tenant-guard`, `check-boundaries`, `review-gate`, `touches-guard`, `check-licenses`.
  - Workflows: `ci`, `pr-gates`, `security` (gitleaks, audit, licenses, SBOM, CodeQL gated), `bootstrap-lockfile`; Dependabot; CODEOWNERS.
  - ADR 0001, `THREAT-MODEL.md`, `SECURITY.md`, `docs/SECURITY.md`, `DEPENDENCIES.md`, `SETUP.md`.
- Open: lockfile bootstrap run, branch protection, Actions SHA pinning, CodeQL enablement (see `HANDOFF.md`).
- Next: backlog-as-code + sync script, contract issues for M2 (schemas) and M3 (tokens).
