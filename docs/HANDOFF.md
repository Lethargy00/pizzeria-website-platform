# Handoff: steps only a human can do

Kept up to date by `orchestrator`. Each item has exact instructions.

1. **Enable branch protection on `main`** (needs GitHub Pro/Team, or a public repo). Require PRs, require the checks `review-gate`, `tenant-guard`, `touches-guard` and CI, and block force-pushes. Until then the Orchestrator checks these manually before each merge. (`docs/DECISIONS.md` #77)
2. **Generate the first lockfile.** Agent sessions can't reach the npm registry. When `platform` opens the first tooling PR, either let CI run `pnpm install --lockfile-only` and commit the result, or run it locally and push to that PR's branch. (#79)
3. **Enable private vulnerability reporting:** Settings → Code security → Private vulnerability reporting → Enable.
4. **Approve milestone release tags** when the Orchestrator asks.

More items (hosting, domains, payment and email credentials, legal review) are added as the modules land.
