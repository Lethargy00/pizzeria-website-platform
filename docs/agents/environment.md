# Agent session environment

Facts about the sandbox agents run in, and how to work within them. These describe the environment, not project decisions. The decision record is `docs/DECISIONS.md` (#76 to #81).

## Network

- **npm registry is reachable.** `https://registry.npmjs.org` answers from agent sessions, including package metadata and the bulk advisory endpoint (`POST /-/npm/v1/security/advisories/bulk`) that `npm audit` uses. `pnpm install --frozen-lockfile` succeeds. This supersedes the "no package installs" note in `docs/DECISIONS.md` #79.
- **GitHub GraphQL is blocked.** Use the REST equivalents in `docs/agents/gh-rest.md`.

## Node version: sandbox is 22, repo pins 26

- The sandbox provides **Node 22** (for example `v22.23.5`). The repo pins `engines.node` to `>=26.0.0 <27` in `package.json`, and `.npmrc` sets `engine-strict=true`.
- Because of that, a plain `pnpm install` or `pnpm exec ...` fails with "Your Node version is incompatible".
- **Workaround, per command only:** prefix the command with `npm_config_engine_strict=false`, for example:

  ```bash
  npm_config_engine_strict=false pnpm install --frozen-lockfile
  npm_config_engine_strict=false pnpm exec prettier --check docs/agents/environment.md
  npm_config_engine_strict=false pnpm lint && npm_config_engine_strict=false pnpm test
  ```

- **Never change `.npmrc`, `package.json` `engines`, or any other config to make the sandbox pass.** The override is a command-line setting that applies to one invocation. Changing the config would weaken the pin for every contributor and for CI.
- **CI on Node 26 is authoritative.** A green local run on Node 22 is evidence, not proof. If local results and CI disagree, trust CI and note the difference in your PR.
- If a check depends on a Node 26 only behaviour, say so in the PR and let CI prove it. Do not work around it locally.

## Checklist for agents

1. Run `node -v`. If it prints 22.x, use the `npm_config_engine_strict=false` prefix on pnpm commands.
2. Do not edit `.npmrc`, `engines`, or CI workflow files to avoid the Node check.
3. Record the local Node version and the prefix used in the PR's test evidence.
4. Trust the CI run on Node 26 for the final verdict.
