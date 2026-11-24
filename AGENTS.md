# AGENTS.md: How every AI agent on this project works

This is the working agreement for **every** AI agent on this repository. Read it fully at the start of **every** session, then read your role file in `.claude/agents/<role>.md`. `PROMPT.md` describes *what* we're building; this file describes *how we work together*.

Repository: `Lethargy00/pizzeria-website-platform`.

---

## 0. Golden rules

1. **GitHub is the only shared memory.** If it's not in an issue, PR, commit or file in this repo, the other agents don't know it. Your session context disappears when you stop.
2. **No issue, no work.** Work only on issues labelled `agent:<your-id>`. Never pick up work yourself. The Orchestrator assigns.
3. **Stay inside your Touches.** Modify only the paths listed under *Touches* in your issue. Everything else belongs to someone else.
4. **Never wait inside your session.** If you're blocked, record it, hand off and **stop**. The Orchestrator wakes you when the blocker is gone (Section 7).
5. **Contracts, not guesses.** Build against merged contracts and mocks, never against another agent's unfinished branch.
6. **Reviews before new work.** If you have a review or a question waiting for your role, handle it first.
7. **Leave a handoff every time you stop.** Done, blocked, interrupted or finished: always.
8. **Only the platform has dependencies.** Never add a `package.json`, lockfile, install step or external script to anything under `tenants/`. Never add or upgrade a platform dependency without an approved `type:dependency` issue.
9. **Never weaken security to make something pass.** Tests, CSP, validation, sanitization and rate limits stay strict.
10. **Never do irreversible external actions** (production deploys, real payments, real emails/SMS, publishing, deleting). Prepare them and list them in `docs/HANDOFF.md`.

---

## 1. Who you are

You are started with a brief like this:
```
You are <role> (agent id <agent-id>). Task: issue #<n>. Worktree: <path>. Branch: <role>/<n>-<slug>.
```
- Your **agent ID** (e.g. `ui-2`) appears in every comment, commit trailer and label.
- Your **role** (e.g. `ui`) decides your role file, the paths you own and the reviews you can give.
- If you were started **without** an issue number, you're a reviewer or the Orchestrator. Follow the start routine and work your queue.

All agents may share one GitHub account, so **your signature is your identity**. Every comment, review and PR description starts with:
```
**[agent: <agent-id> · role: <role>]**
```

---

## 2. Session start routine (do this every time, in order)

```bash
# 1. Make sure you're in YOUR worktree and up to date
git -C <worktree> fetch origin
git -C <worktree> status

# 2. Is main broken? If so, only the assigned fixer works; everyone else does reviews or stops.
gh issue list --label main-broken --state open

# 3. Your review / question queue (reviewer roles: architect, security, a11y-perf, qa)
gh pr list --state open --label "review:<role>"
gh issue list --state open --label "status:needs-<role>"     # e.g. status:needs-security

# 4. Your assigned work
gh issue list --state open --label "agent:<agent-id>" --json number,title,labels

# 5. Read your issue completely (Section 4)
gh issue view <n> --comments
```

Then work in this **priority order**:
1. A `main-broken` issue assigned to you.
2. Reviews (`review:<role>` PRs) and questions (`status:needs-<role>` issues) for your role.
3. Change requests on **your own** open PR.
4. Your assigned issue.
5. Nothing else. If the queue is empty, post nothing, change nothing, and stop.

---

## 3. Finding your work

- You never choose issues. The Orchestrator gives one to you by adding `agent:<agent-id>` and commenting `Assigned to <agent-id>`.
- **One in-progress issue at a time.** If you somehow have two, comment on the newer one and tell the Orchestrator.
- If your assigned issue isn't `status:ready`, don't start it. Comment, and stop (Section 7.2).
- Found something that needs doing (a bug, a missing test, a gap in a contract)? **Open a new issue** using the right template, label it `role:<owner-role>`, link it from your issue, and carry on with your own task. Don't fix it yourself unless it's inside your Touches **and** inside your issue's scope.

---

## 4. How to read an issue properly

Read **all** of it before writing any code:

1. **Body, top to bottom:** Context, Scope (in/out), Acceptance criteria, Touches, Contracts, Blocked by, Security notes, Test plan, Definition of done.
2. **All comments, oldest to newest.** When comments conflict, **the newest comment from the Orchestrator, Architect or Security Reviewer wins** over the body.
3. **The parent epic** (`gh issue view <epic#>`) for the bigger picture.
4. **Linked ADRs** in `docs/adr/` and the **contracts** it consumes (`packages/schema/`, `packages/*/src/contracts/`) **as they are on `origin/main`**.
5. **Linked PRs** that touched the same area recently (`git log origin/main -- <path>`).
6. **Relevant `PROMPT.md` sections** (security: Section 6, tests: Section 7).

Then write a **START comment** (Section 11) restating, in your own words, what you'll deliver, your plan, and any open questions. If something in the issue is contradictory or missing, ask now (Section 7.4). Don't guess about contracts or security.

---

## 5. Before you start: readiness and collision checks

Do **all** of these. If any check fails, don't start. Go to Section 7.

| Check | How |
|---|---|
| The issue is `status:ready` and labelled `agent:<your-id>` | `gh issue view <n> --json labels` |
| **Every blocker is closed as completed** (closed via a merged PR, not just closed) | For each `Blocked by: #b`: `gh issue view <b> --json state,stateReason` → `CLOSED` / `COMPLETED` |
| The blockers' work is **on `origin/main`** | `git fetch origin && git log origin/main --oneline -- <contract path>` |
| No other agent has started this issue | No START comment from another agent ID after the latest `Assigned to` comment |
| **No open PR touches the same paths** | `gh pr list --state open --json number,headRefName,files` and compare with your Touches |
| Your worktree and branch exist and are based on the latest `origin/main` | `git -C <worktree> rebase origin/main` |

If someone else's open PR touches your paths: **don't continue.** Comment on your issue: `COLLISION with #<pr> on <paths>`, add `status:blocked`, and stop. The Orchestrator resolves it.

---

## 6. Doing the work

- Work **only** in your worktree, on your branch `<role>/<issue#>-<slug>`. Never commit to `main`. Never push to another agent's branch.
- **Open a draft PR early** (after your first meaningful commit) so others can see what you're touching:
  ```bash
  gh pr create --draft --title "<type>: <summary> (#<n>)" --body-file .github/pull_request_template.md
  ```
  Make sure the PR body contains `Closes #<n>` and your signature.
- **Commits:** small and logical, conventional messages, with the trailer:
  ```
  Agent: <agent-id>
  ```
- **Stay in Touches.** Before every push run:
  ```bash
  git diff --name-only origin/main...HEAD
  ```
  Every file must match your Touches globs. If you *need* a change elsewhere (a shared config, the lockfile, a contract), **don't make it**. Open or comment on an issue for that file's owner (Section 8) and continue with the rest.
- **Contracts:** import only from merged contracts. If a contract is wrong or missing something, open a `type:contract` issue, label it `status:needs-architect`, and continue with what you can. Use a local mock that follows the *current* contract.
- **Dependencies:** never run `pnpm add` or edit dependency lists. If you need a package, open a `type:dependency` issue and continue without it if you can.
- **Tests:** write the tests in the issue's test plan. Run the full local check before marking the PR ready:
  ```bash
  pnpm lint && pnpm typecheck && pnpm test && pnpm tenant-guard
  ```
  Also run the relevant e2e, visual and a11y suites (see your role file).
- **Progress:** post a PROGRESS comment at least once per work session. If you go quiet for two Orchestrator loops, your issue may be reassigned.

---

## 7. The waiting protocol: how we wait for each other

### 7.1 The core rule
**Agents don't wait by looping, sleeping or polling.** Your session is short-lived. When you can't continue:
1. Push what you have (if anything) to your draft PR.
2. Record **exactly what you're waiting for**, with a link (issue/PR number).
3. Set the right label (see the table below).
4. Post a **HANDOFF** comment.
5. **Stop the session.**

The **Orchestrator** is the only agent that watches the clock. On every loop it checks what each waiting agent is waiting for, and **resumes** the agent (with the same agent ID, issue and worktree) as soon as that's resolved. Agents never need to check back on their own.

### 7.2 What to do in each situation

| Situation | What you do | Label you set | Who resumes you, and when |
|---|---|---|---|
| **Blocked before starting** (a blocker is still open, or its PR isn't merged) | BLOCKED comment listing the open blockers. Don't create a branch. | `status:blocked` | Orchestrator, when all blockers are closed *and* merged |
| **Blocked mid-way** by a missing or wrong contract | Push WIP to the draft PR. Open or link a `type:contract` issue. BLOCKED comment saying what part is waiting. **If other parts of your issue don't depend on it, finish those first.** | `status:blocked` on your issue; `status:needs-architect` on the contract issue | Orchestrator, after the contract PR merges |
| **Need an answer** from another role | QUESTION comment on your issue addressed to the role, with one clear question and your proposed default. Continue with any independent parts. If nothing is left, hand off and stop. | `status:needs-architect` / `needs-security` / `needs-info` | Orchestrator, when an ANSWER comment appears |
| **Need a change in someone else's file** (lockfile, workflow, shared config, another component) | Comment on, or open, an issue for the owning role describing the exact change needed. Continue without it if possible. | `status:blocked` only if you can't continue at all | Orchestrator, after that change merges |
| **Collision** with another open PR on your paths | COLLISION comment. Don't touch the overlapping files. | `status:blocked` | Orchestrator, after it resolves the order |
| **Your PR is waiting for review** | Mark the PR ready. Make sure the checks pass. Post a HANDOFF comment. **Don't start anything new.** | `status:in-review` on the issue | Orchestrator, when changes are requested or the PR is merged |
| **Changes requested on your PR** | Fix every checkbox point. Reply to each one. Push. Re-request review by commenting `READY FOR RE-REVIEW`. | keep `status:in-review` | Reviewer is re-queued by the Orchestrator |
| **`main` is broken** (not your issue) | Don't push or merge anything. Do reviews only, or stop. | none | Orchestrator, when the `main-broken` issue closes |
| **Your work depends on a PR that is approved but not merged yet** | Treat it as still blocked. Never branch from or import another agent's unmerged branch. | `status:blocked` | Orchestrator, after merge |
| **You failed the same thing twice** | HANDOFF with what you tried and the error output. | `status:blocked` + comment `ESCALATE` | Orchestrator routes it to the Architect or Security |

### 7.3 When you're resumed
1. Run the **session start routine** (Section 2) again from the top.
2. Re-read your issue **including all new comments** since your last HANDOFF.
3. `git fetch origin && git rebase origin/main` in your worktree. Fix conflicts **only in files inside your Touches**. If a conflict is outside them, stop and comment.
4. Remove `status:blocked` / `needs-*` from your issue only if the reason is really gone, then post a RESUMED comment and continue.

### 7.4 Asking good questions
- Ask **one question per comment**, addressed to one role, with **your proposed answer**: *"Proposal: use X because Y. I'll proceed with X on the independent parts unless you object."*
- Never ask the human. After intake, only the Orchestrator talks to the human, and only about `docs/HANDOFF.md` items or milestone release approvals.

---

## 8. Letting others work: respecting boundaries

- **Ownership** is defined in `PROMPT.md` Section 11.1 and enforced by `CODEOWNERS`. Shared hot files (root `package.json`, `pnpm-lock.yaml`, `turbo.json`, `tsconfig.base.json`, `.github/workflows/`, `CODEOWNERS`) belong to `platform`. Contracts belong to `architect`.
- **Never** edit, rebase, push to, close or relabel another agent's issue or PR, except:
  - reviewers adding `approved:<role>` or `security:blocking` on PRs they review;
  - the Orchestrator, which manages labels and assignments for everyone.
- **Never** "quickly fix" something in another agent's area, even if it's a one-liner. Open an issue instead. This keeps ownership and reviews clean, and prevents two agents editing the same file.
- **Never** update another component's visual baselines, tests or fixtures.
- If you see something wrong in someone else's open PR, leave a **review comment** on that PR. Don't change it.
- **Generated or shared registries** are auto-discovered. If you think you need to edit a central index file, you're doing it wrong. Re-read the contracts or ask the Architect.

---

## 9. Opening and finishing a PR

Before marking your PR **ready for review**:
- [ ] Rebased on the latest `origin/main`, all local checks pass.
- [ ] `git diff --name-only origin/main...HEAD` ⊆ Touches.
- [ ] PR body: `Closes #<n>`, signature, summary, list of changed paths, test evidence, and screenshots for UI (mobile and desktop, one per starter theme).
- [ ] Every acceptance criterion is checked off, with a pointer to where it's proven (test name, screenshot, file).
- [ ] Docs updated, or a linked `type:docs` issue exists.
- [ ] No new dependencies, no tenant package files, no external URLs in tenant content.
- [ ] HANDOFF comment posted on the issue.

Then:
```bash
gh pr ready <pr#>
gh issue edit <n> --remove-label "status:in-progress" --add-label "status:in-review"
```
**Don't merge your own PR.** The Orchestrator merges once the review matrix is satisfied.

---

## 10. Reviewing (any agent asked to review)

- Review **only** PRs labelled `review:<your-role>`. Never review your own work, or work your instance wrote earlier.
- Check out the PR in a **separate, read-only worktree**. Don't push to it.
- Read the linked issue first. Review against its acceptance criteria, Touches, the contracts, your role's checklist (in your role file) and `PROMPT.md` Section 6.
- Decide clearly:
  - **APPROVED** → APPROVED comment with a short rationale, then swap the labels:
    ```bash
    gh pr edit <pr#> --remove-label "review:<role>" --add-label "approved:<role>"
    ```
  - **CHANGES REQUESTED** → a CHANGES REQUESTED comment with **every blocking point as a checkbox**, plus optional, clearly marked non-blocking suggestions. Leave `review:<role>` in place.
- Security only: add `security:blocking` for anything that must not merge. Only `security` may remove it.
- Don't let a review sit waiting: reviews come before your own new work.

---

### 10.1 The review matrix and the `review-gate` check

The `review-gate` CI job reads a PR's changed paths and labels, compares them with the `MATRIX` in `scripts/review-gate.mjs`, and fails if a required `approved:<role>` label is missing. PROMPT.md §11.2 is the human summary of the same matrix. The rows that matter most for security:

- **`peer`**: every PR needs `approved:peer`.
- **`security`** (`approved:security`): a PR with the label `security:sensitive`, or one that changes a security-sensitive path. The list includes `.github/workflows/**`, the gate scripts `scripts/review-gate.mjs`, `scripts/touches-guard.mjs` and `scripts/tenant-guard.mjs`, `.github/CODEOWNERS`, and the functions, adapters, forms, CSP, headers and sanitizer paths.
- **`richtext`** (`approved:security`, ADR 0002 Enforcement (c), #81): any change to one of these paths requires `approved:security`, even when no other row applies:
  - `packages/core/src/richtext/**` (`renderMarkdown`, the `SafeHtml` constructor, the sanitize schema)
  - `packages/core/package.json` (the `./richtext` subpath export)
  - `scripts/boundaries.json` and `scripts/check-boundaries.mjs` (the ADR 0002 (a) import rule and its check)
  - `scripts/check-html-sinks.mjs` (the ADR 0002 (b) and (d) HTML-sink check)
  - `scripts/test/richtext-*` and `scripts/test/*html-sink*` (the fixtures that prove those checks)

**Security-reviewed paths in CODEOWNERS.** `.github/CODEOWNERS` marks these paths as security-reviewed with a "security" note. CODEOWNERS uses the last matching pattern, so a line is only as good as the last line that matches its path. The test described below checks this for every path, so no later line overrides a security note. The paths sit in different places in the file:

- the workflows: `/.github/workflows/` and `/.github/CODEOWNERS` (the last section)
- the gate scripts: `/scripts/review-gate.mjs`, `/scripts/touches-guard.mjs`, every `/scripts/*-guard.mjs`, and `/scripts/lib/`, which the gates share (the last section)
- the rich-text paths in the `richtext` row above (the last section)
- `/scripts/check-licenses.mjs` and the root pnpmfiles `/.pnpmfile.cjs` and `/.pnpmfile.mjs` (the last section)
- `/SECURITY.md`, `/docs/SECURITY.md`, `/docs/THREAT-MODEL.md`, `/packages/functions/` and `/packages/adapters/` (their role entries, whose notes say security)
- the dependency paths: `/pnpm-lock.yaml`, `/package.json`, `/pnpm-workspace.yaml` and `/.npmrc` (in the platform block at the top), and `/playground/package.json`, `/packages/*/package.json` and the alternate manifests `package.yaml` and `package.json5` at the root, in `/playground/` and in `/packages/*/` (in the dependency-manifests block, above the "Kept LAST" header). They are the `DEPENDENCY_PATHS`, `ALT_MANIFESTS` and `PACKAGE_MANIFESTS` constants in `scripts/review-gate.mjs`
- the remaining code paths in the `security` row: the form, sanitizer, CSP and headers paths, `/packages/cli/src/build/`, `/packages/cli/src/isolation/` and `**/.env.example` (the last section)

This list may not be complete. The source of truth is `scripts/test/review-gate-richtext.test.mjs`. It imports those constants and the `security` row of the matrix, and fails if any dependency path or `security`-row glob resolves to a CODEOWNERS line without a security note, or if the owners on any line are anything but exactly `@Lethargy00`.

Every CODEOWNERS entry currently maps to the one shared GitHub account, so the comment after each entry, not the account, says which role must review. The CODEOWNERS notes are wider than the `security` row in two ways: they also mark the `richtext` row paths, which `review-gate` enforces through the `richtext` row, and the dependency paths, which it enforces through the `dependency` row (`approved:architect` and `approved:security`).

## 11. Comment formats (copy exactly)

Every comment starts with the signature line. Use one of these types as the first word after it:

```markdown
**[agent: ui-2 · role: ui]** START
Deliver: … | Plan: 1) … 2) … 3) … | Touches confirmed: `packages/ui/src/components/Hero/**` | Questions: none

**[agent: ui-2 · role: ui]** PROGRESS
Done: … | Next: … | Risks: …

**[agent: ui-2 · role: ui]** BLOCKED
Waiting for: #34 (contract: HeroProps needs `video` variant) | Completed meanwhile: … | Resume when: #34 merged

**[agent: ui-2 · role: ui]** QUESTION → architect
Should `cta` accept external URLs? Proposal: internal page keys only (safer); I'll proceed with that unless you object.

**[agent: architect · role: architect]** ANSWER
Internal page keys only. Recorded in ADR-0007.

**[agent: ui-2 · role: ui]** COLLISION
Open PR #51 also touches `packages/ui/src/components/Hero/variants/`. Not touching those files. Orchestrator please sequence.

**[agent: ui-2 · role: ui]** RESUMED
Blocker #34 merged; rebased on main; continuing with step 3.

**[agent: ui-2 · role: ui]** HANDOFF
Done: … | Not done: … | Decisions made: … | Follow-up issues: #… | How to verify: `pnpm --filter ui test Hero` | State: in-review / blocked on #… / interrupted

**[agent: security · role: security]** APPROVED
Checked: input validation, CSP impact, no new origins, no PII in logs.

**[agent: security · role: security]** CHANGES REQUESTED
- [ ] Rich text rendered without sanitizer in `Body.astro:42`
- [ ] Missing rate limit on `/api/contact`
Non-blocking: consider …
```

---

## 12. Stopping a session

Whenever you stop, for any reason:
1. Commit and push everything worth keeping to your branch. Never leave work only in your worktree.
2. Make sure your issue's labels match reality (`in-progress`, `in-review` or `blocked`).
3. Post a **HANDOFF** comment.
4. Stop. Don't start "just one more thing".

---

## 13. `gh` quick reference

```bash
# Queues
gh issue list --state open --label "agent:<agent-id>"
gh pr list    --state open --label "review:<role>"
gh issue list --state open --label "status:needs-<role>"

# Read
gh issue view <n> --comments
gh issue view <n> --json state,stateReason,labels,body
gh pr view <pr#> --comments --json files,labels,reviewDecision,statusCheckRollup
gh pr diff <pr#> --name-only
gh pr list --state open --json number,headRefName,files     # collision check

# Write (always with signature)
gh issue comment <n> --body-file comment.md
gh issue edit <n> --add-label "status:blocked" --remove-label "status:in-progress"
gh issue create --template task.yml          # or bug / contract / dependency / security-finding / adr
gh pr create --draft --title "…" --body-file pr.md
gh pr ready <pr#>
gh pr checks <pr#>
```
