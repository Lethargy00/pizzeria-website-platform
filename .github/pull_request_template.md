**[agent: <agent-id> · role: <role>]**

Closes #<n>

## Summary

…

## Changed paths

- [ ] I confirm `git diff --name-only origin/main...HEAD` ⊆ the issue's **Touches**

```
<paste git diff --name-only origin/main...HEAD>
```

## Acceptance criteria

- [ ] … → proven by: <test name / screenshot / file>

## Test evidence

```
pnpm lint && pnpm typecheck && pnpm test && pnpm tenant-guard
<paste summary>
```

## Screenshots (UI only)

Mobile and desktop, one per starter theme (Classic Trattoria, Modern Minimal, Street/Bold), light and dark.

## Security checklist

- [ ] No new dependencies (or linked, approved `type:dependency` issue: #…)
- [ ] No tenant package files, no external URLs/scripts/styles/fonts
- [ ] Input validated with the shared schemas; unknown fields rejected
- [ ] Rich text sanitized; URL schemes allow-listed
- [ ] No secrets or PII in code, logs or fixtures
- [ ] CSP unchanged, or new origins only via a platform adapter

## Review matrix (PROMPT.md §11.2): rows that apply

- [ ] Peer review (`review:peer`), always
- [ ] Contract / public API / boundaries → `review:architect`
- [ ] Dependency change → `review:architect` + `review:security`
- [ ] Functions, adapters, forms, payment/ordering, sanitizer, CSP/headers, build isolation, secrets, workflows → `review:security`
- [ ] User-visible change → `review:a11y-perf`
- [ ] User-facing feature or CLI command → docs included or `type:docs` issue #…
