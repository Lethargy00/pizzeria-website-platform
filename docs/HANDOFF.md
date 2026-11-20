# Handoff: steps only a human can do

Kept up to date by `orchestrator`. Each item has exact instructions.

1. **Lockfile bootstrap.** Done automatically: `bootstrap-lockfile` regenerates `pnpm-lock.yaml` whenever a `package.json` changes and then dispatches `ci` and `security`. If a run is red, tell the Orchestrator (agent sessions can read check results but not full logs).
2. **Enable branch protection on `main`** (needs GitHub Pro/Team, or a public repo). Settings → Rules → New ruleset: target `main`, require a pull request, require the checks listed in `docs/SECURITY.md` §"Recommended repository setup", block force-pushes. Until then the Orchestrator checks them before each merge. (DECISIONS #77)
3. **Pin GitHub Actions to commit SHAs.** Agent sessions can't read other repositories. On a machine with `gh`, run `npx pinact run` (or edit each `uses:` to `<owner>/<action>@<full-sha> # vX.Y.Z`) in `.github/workflows/` and commit. Dependabot keeps them current afterwards. (Threat model finding 1)
4. **Enable code scanning** (optional, needs GitHub Code Security on a private repo): Settings → Code security → enable Code scanning, then Settings → Secrets and variables → Actions → Variables → add `CODE_SCANNING_ENABLED` = `true`. (Finding 3)
5. **Enable private vulnerability reporting** and **Dependabot alerts/security updates**: Settings → Code security.
6. **Approve milestone release tags** when the Orchestrator asks.

More items (hosting, domains, email credentials, legal review) are added as the modules land.
