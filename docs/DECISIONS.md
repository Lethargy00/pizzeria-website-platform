# Decisions

Final intake answers (PROMPT.md Section 3). Each entry is marked `user` (answered by the human) or `default` (the documented default was used). Later lasting decisions go into `docs/adr/`, not here.

Recorded by `orchestrator` on 2026-11-20.

## Business and scope

1. **Q1.1 Platform name:** `pizzeria-website-platform`. Workspace package scope `@pwp/*`, CLI binary `pwp`. — `user`
2. **Q1.2 Countries:** Sweden only. — `user`
3. **Q1.3 Languages:** Swedish (`sv`) and English (`en`). Each tenant picks one or both; `sv` is the default locale. — `default`
4. **Q1.4 Currency:** SEK only, for display. Menu prices are shown exactly as the tenant enters them (consumer prices, VAT included); the platform does no VAT calculation (see 56). — `default`
5. **Q1.5 Scale:** 5 tenants in year 1, 50 in year 3. — `default`
6. **Q1.6 Operator:** agency/franchise. The platform team onboards tenants; no self-signup. — `default`
7. **Q1.7 Multiple locations:** yes. 1..n locations per tenant, with menu and price overrides per location. — `default`
8. **Q1.8 Visual direction:** none given. Three distinct starter themes (see 21). — `default`

## Repository and tenancy

9. **Single dependency root:** hard rule (PROMPT.md 3.2 and Section 6). Not a question.
10. **Q2.1 Content location:** (A) monorepo, `tenants/<slug>/`. — `default`
11. **Q2.2 Pin older platform release per tenant:** no. All tenants build from the same commit. — `default`
12. **Q2.3 Publish packages to a registry:** no. All workspace packages are `"private": true`. — `default`
13. **Q2.4 Who edits content:** developers via PRs (YAML/Markdown) in v1, behind a content interface so a CMS can be added later. — `default`

## Technical stack

14. **Q3.1 Framework:** Astro with strict TypeScript. — `default`
15. **Q3.2 Rendering:** static plus a small set of serverless functions (forms, ordering, payment webhooks). — `default`
16. **Q3.3 Styling:** design tokens as CSS custom properties from a typed token schema; scoped component CSS; no runtime CSS-in-JS. — `default`
17. **Q3.4 Island library:** Preact or Solid, whichever is smaller for the needs. Final choice via ADR + `type:dependency` issue. — `default`
18. **Q3.5 Package manager / monorepo tool:** pnpm workspaces + Turborepo. — `default`
19. **Q3.6 Node version:** Node 26 (Active LTS since 2026-10-28, supported to 2029-04-30), pinned in `.nvmrc` (`26`) and `engines` (`>=26 <27`); pnpm 10.28.0 via `packageManager`. — `default`
20. **Q3.7 Database:** none in v1 (no ordering, see 32). — `default`

## Customization and theming

21. **Q4.1 Starter themes:** 3: _Classic Trattoria_, _Modern Minimal_, _Street/Bold_. — `default`
22. **Q4.2 Customizable:** all listed items, through validated config only. — `default`
23. **Q4.3 Fonts:** self-hosted only; curated open-licensed fonts per theme; tenants may upload their own licensed WOFF2. — `default`
24. **Q4.4 Variants:** yes, 2–4 per major section. — `default`
25. **Q4.5 Component overrides:** only through variants and slots, no code. — `default`
26. **Q4.6 Custom-code escape hatch:** off. — `default`
27. **Q4.7 Accessibility:** WCAG 2.2 AA; theme builds fail on contrast violations. — `default`
28. **Q4.8 Theme preview:** local playground only; no no-code editor in v1. — `default`

## Features

29. **Q5.1 Menu:** everything listed, in v1. — `default`
30. **Q5.2 Opening hours:** in v1. Time zone `Europe/Stockholm`; Swedish public holidays (incl. midsommarafton, julafton, nyårsafton as common closing days) supported as data. — `default`
31. **Q5.3 Locations/maps:** in v1; static map image or click-to-load map, nothing third-party before consent. — `default`
32. **Q5.4 Online ordering:** **not in v1.** No cart, checkout or order handling. v1 supports "order via external link" (a delivery platform or the pizzeria's own system) and click-to-call per location. The full ordering module moves to the `Later` milestone. — `user` ("forget about payments"; moving ordering to Later is the Orchestrator's reading, since it depends on payments)
33. **Q5.5 Payments:** **out of scope.** No payment providers or adapters, no Stripe, Swish or Klarna, no webhooks. — `user`
34. **Q5.6 Delivery zones:** _later_, with the ordering module. v1 may show delivery areas as plain text per location. — `user` (follows from 32)
35. **Q5.7 Reservations:** request form (email) or external booking link in v1; full reservations _later_. — `default`
36. **Q5.8 CMS:** _later_; content interface defined now. — `default`
37. **Q5.9 Contact / catering forms:** in v1, with spam protection and rate limiting. — `default`
38. **Q5.10 Newsletter:** _later_, adapter only. — `default`
39. **Q5.11 Gallery / about / reviews:** gallery and about in v1; reviews only as verifiable links/embeds to real review platforms. — `default`
40. **Q5.12 Gift cards, loyalty, coupons:** _later_. — `default`
41. **Q5.13 Print menu + QR:** in v1. — `default`
42. **Q5.14 Notifications:** email + generic webhook in v1; SMS and POS _later_. — `default`

## Content, SEO, performance

43. **Q6.1 Content format:** YAML for structured data, plain Markdown for prose, validated with Zod. — `default`
44. **Q6.2 SEO:** per-page meta, Open Graph, sitemap, robots.txt, canonical, hreflang (`sv-SE`, `en`), schema.org `Restaurant` / `Menu` / `OpeningHoursSpecification`. — `default`
45. **Q6.3 Performance budget:** Lighthouse ≥ 95 in all four categories on mid-range mobile; JS ≤ 50 KB gz per page; LCP < 2.0 s. — `default`
46. **Q6.4 Images:** build-time AVIF/WebP, `srcset`, explicit dimensions, lazy loading, EXIF stripped. — `default`
47. **Q6.5 Analytics:** none by default; optional cookieless adapter per tenant. — `default`

## Hosting and operations

48. **Q7.1 Hosting:** provider-agnostic static output plus serverless functions behind a deploy adapter. Prefer an EU region for functions and data (GDPR). — `default`
49. **Q7.2 Deployments:** one isolated build and deployment per tenant. — `default`
50. **Q7.3 Domains:** own domain and `<slug>.<platform-domain>` both supported. — `default`
51. **Q7.4 Environments:** preview per PR, `staging` and `production` per tenant; production promotion is manual. — `default`
52. **Q7.5 Email:** adapter interface with console/mock adapter. — `default`
53. **Q7.6 Monitoring:** uptime check per tenant, optional error-reporting adapter, no PII in logs. — `default`
54. **Q7.7 Backups:** content in Git; if a database is used, daily backup and a documented restore drill. — `default`

## Security and compliance

55. **Q8.1 Compliance (Sweden):** GDPR (enforced by IMY); cookie consent under the Swedish Electronic Communications Act (LEK); EU food-information regulation 1169/2011 for allergen information (Livsmedelsverket guidance); Swedish price-information and marketing law (prices to consumers shown including VAT). Template privacy, cookie and terms pages per tenant, marked "template – have this reviewed by a lawyer". — `default`
56. **VAT:** **out of scope.** The platform does not compute, split or display VAT. Tenants enter final consumer prices. — `user`
57. **Q8.2 Security baseline:** OWASP ASVS Level 2 for server-side code, OWASP Top 10, plus PROMPT.md Section 6. — `default`
58. **Q8.3 Cookie consent:** nothing non-essential before consent; banner only when a tenant enables something that needs it. — `default`
59. **Q8.4 Repo admin / security review:** recommended setup documented in `docs/SECURITY.md`: CODEOWNERS for `packages/` and `.github/`, branch protection, two-person review on `main`. See 74 for the current limitation. — `default`
60. **Q8.5 Vulnerability disclosure:** `SECURITY.md` with GitHub private vulnerability reporting. — `default`

## Quality, process, handoff

61. **Q9.1 Testing depth:** PROMPT.md Section 7. — `default`
62. **Q9.2 CI:** GitHub Actions. — `default`
63. **Q9.3 License:** proprietary, all rights reserved; every dependency, font and image must allow commercial use. — `default`
64. **Q9.4 Docs language:** English. Site content of the demo tenants in Swedish and English. — `default`
65. **Q9.5 Demo content:** three fictional demo tenants, one per theme, invented names, open-licensed or generated imagery. — `default`
66. **Q9.6 Real first pizzeria:** none; demo tenants only. — `default`

## GitHub and the AI team

67. **Q10.1 Repository:** `Lethargy00/pizzeria-website-platform` (private). Access verified via the REST API with admin permission. — `user`
68. **Q10.2 Agent runtime:** Claude Code; main session is the Orchestrator; roles in `.claude/agents/<role>.md`; one git worktree per parallel agent. — `default`
69. **Q10.3 Max parallel implementers:** 4 (reviewers don't count). — `default`
70. **Q10.4 Agents may merge to `main`:** yes, Orchestrator merges when CI is green and the review matrix is met; the human approves each milestone release tag. — `default`
71. **Q10.5 Human-review paths:** none required; human notified on milestone completion and any `security:critical` finding. — `default`
72. **Q10.6 Separate GitHub identities per role:** no; one account, role signatures, `approved:<role>` labels checked by CI. — `default`
73. **Q10.7 Project board:** **no board.** Status, role, priority, size and agent are tracked with labels; milestones track M1–M9 and `Later`. Saved "views" are documented as `gh issue list` label queries in `AGENTS.md`-compatible form. — `user`
74. **Q10.8 Sub-issues and dependencies:** native sub-issues and "blocked by" via the REST API where available, always mirrored in the issue body (`Blocked by: #12`). — `default`
75. **Q10.9 Team changes:** none; team as defined in Section 11. — `default`

## Environment notes (facts about where the agents run, not choices)

76. **No GraphQL from agent sessions.** `gh` commands that use GraphQL (`gh issue list`, `gh pr list`, `gh pr create`, `gh issue edit`, Projects) fail. Agents use the REST equivalents via `gh api repos/Lethargy00/pizzeria-website-platform/...`. The `gh` commands in `AGENTS.md` describe intent; the REST mapping is in `docs/agents/gh-rest.md`. This is a deliberate block in the network layer of the cloud agent sessions, not a token or scope problem, so it can't be fixed from inside a session. Agents running in Claude Code on the human's own machine (with their own `gh auth login`) don't have this limit; there, the porcelain `gh` commands and a Projects board work.
77. **No branch protection.** GitHub refuses branch protection and rulesets on this private repo on the current (free) plan. Until the repo is upgraded or made public, `review-gate`, `tenant-guard` and `touches-guard` cannot be _required_ checks; the Orchestrator must check them before every merge. Listed in `docs/HANDOFF.md`.
78. **No GitHub Actions API.** Workflow runs can't be read through `gh run` from agent sessions. The Orchestrator reads CI results through `GET /repos/{owner}/{repo}/commits/{sha}/check-runs` and `/status` (verified reachable on 2026-11-20).
79. **No package installs in agent sessions.** The agents' shell can't reach the npm registry, so `pnpm install` and lockfile generation can't run locally. `pnpm-lock.yaml` must be generated in CI (or by the human) on the first `platform` PR. Tracked as a `status:blocked` risk on the M1 epic.
80. **Sessions are not long-running.** Each agent session ends when it replies. The Orchestrator's wait-with-backoff loop (Appendix B.1) therefore runs as one loop per session, resumed by the human or by a scheduled task.
81. **M1 Foundation built without PRs.** At the human's request (2026-11-20), the M1 foundation (tooling, CI, guard scripts, ADR 0001, threat model, security docs) was committed directly to `main` by `orchestrator`, without issues, PRs or role reviews. The planning PR #2 was merged the same way. From M2 on, the normal flow in `AGENTS.md` applies (issue → PR → review matrix → merge). — `user`
