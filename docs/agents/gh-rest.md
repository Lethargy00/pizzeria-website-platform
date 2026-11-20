# `gh` REST equivalents for agent sessions

Agent sessions can't use GitHub's GraphQL API (see `docs/DECISIONS.md` #76). Node version and npm notes for agent sessions are in `docs/agents/environment.md`. Most porcelain commands in `AGENTS.md` (`gh issue list`, `gh pr create`, `gh issue edit`, `gh pr view --json`) use GraphQL and fail with HTTP 403. Use the REST calls below. They mean the same as the commands in `AGENTS.md`; only the spelling differs.

```bash
R=repos/Lethargy00/pizzeria-website-platform
```

| `AGENTS.md` command                                            | REST equivalent                                                                                                        |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `gh issue list --label main-broken --state open`               | `gh api "$R/issues?state=open&labels=main-broken" --jq '.[] \| select(.pull_request\|not) \| "#\(.number) \(.title)"'` |
| `gh issue list --label "agent:<id>"`                           | `gh api "$R/issues?state=open&labels=agent:<id>" --jq '.[] \| select(.pull_request\|not) \| "#\(.number) \(.title)"'`  |
| `gh pr list --label "review:<role>"`                           | `gh api "$R/issues?state=open&labels=review:<role>" --jq '.[] \| select(.pull_request) \| "#\(.number) \(.title)"'`    |
| `gh issue view <n> --comments`                                 | `gh api $R/issues/<n> --jq .body` and `gh api "$R/issues/<n>/comments?per_page=100" --jq '.[].body'`                   |
| `gh issue view <n> --json state,stateReason,labels`            | `gh api $R/issues/<n> --jq '{state, state_reason, labels: [.labels[].name]}'`                                          |
| `gh issue comment <n> --body-file c.md`                        | `gh api $R/issues/<n>/comments -F body=@c.md`                                                                          |
| `gh issue edit <n> --add-label X`                              | `gh api $R/issues/<n>/labels -f 'labels[]=X'`                                                                          |
| `gh issue edit <n> --remove-label X`                           | `gh api -X DELETE "$R/issues/<n>/labels/$(jq -rn --arg l X '$l\|@uri')"`                                               |
| `gh issue create …`                                            | `gh api $R/issues -f title='…' -F body=@body.md -f 'labels[]=type:feature' -F milestone=<number>`                      |
| `gh pr create --draft …`                                       | push the branch, then `gh api $R/pulls -f title='…' -f head='<branch>' -f base=main -F body=@pr.md -F draft=true`      |
| `gh pr ready <pr#>`                                            | `gh api -X POST $R/pulls/<pr#>/ccr/ready_for_review`                                                                   |
| `gh pr edit <pr#> --add-label/--remove-label`                  | same as the issue label calls, with the PR number                                                                      |
| `gh pr diff <pr#> --name-only`                                 | `gh api "$R/pulls/<pr#>/files?per_page=100" --jq '.[].filename'`                                                       |
| `gh pr list --json number,headRefName,files` (collision check) | `gh api "$R/pulls?state=open" --jq '.[] \| "\(.number) \(.head.ref)"'`, then the files call per PR                     |
| `gh pr checks <pr#>`                                           | `gh api $R/commits/<head-sha>/check-runs --jq '.check_runs[] \| "\(.name): \(.conclusion // .status)"'`                |
| merge (Orchestrator only)                                      | `gh api -X PUT $R/pulls/<pr#>/merge -f merge_method=squash`                                                            |

Native sub-issues and dependencies (if the endpoints respond; always mirror them in the issue body too):

```bash
gh api $R/issues/<parent>/sub_issues -F sub_issue_id=<child issue *id*, not number>
gh api $R/issues/<n>/dependencies/blocked_by -F issue_id=<blocker issue id>
```

Saved "views" (no Projects board, `docs/DECISIONS.md` #73):

| View               | Query                                                                 |
| ------------------ | --------------------------------------------------------------------- |
| My queue (`<id>`)  | `labels=agent:<id>`                                                   |
| Ready, unassigned  | `labels=status:ready`, then filter out issues with any `agent:` label |
| Blocked            | `labels=status:blocked`                                               |
| Waiting for a role | `labels=status:needs-<role>` and `labels=review:<role>`               |
| Critical path      | `labels=priority:p0` and `labels=priority:p1`                         |
