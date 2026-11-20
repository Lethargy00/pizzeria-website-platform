# Threat model (STRIDE)

Owner: `security`. Update whenever a module that touches data or money is added (PROMPT.md §6). Version: 2026-11-20, foundation (M1). Scope reflects v1: static sites, contact/catering/reservation-request forms, no payments, no ordering.

## System and trust boundaries

```
 Visitor browser ──HTTPS──▶ Static site (per tenant, own origin) ──POST──▶ Functions (per tenant)
                                                                              │
                                                                              ├─▶ Email adapter (provider)
                                                                              └─▶ Webhook adapter (tenant URL)
 Platform repo (GitHub) ──CI──▶ pwp build <slug> ──▶ dist/<slug>/ ──deploy adapter──▶ Hosting
        ▲
 Agents / platform team (PRs)      Tenant content = data in tenants/<slug>/ (edited via PRs)
```

Boundaries: (B1) visitor ↔ site/functions; (B2) tenant content ↔ build; (B3) tenant ↔ tenant; (B4) contributors/agents ↔ repo and CI; (B5) platform ↔ third parties (npm, GitHub Actions, email, hosting, map/analytics adapters).

## Actors

| Actor                      | Trust             | Notes                                                                               |
| -------------------------- | ----------------- | ----------------------------------------------------------------------------------- |
| Visitor                    | untrusted         | Anonymous; can send any request to functions.                                       |
| Tenant content author      | semi-trusted      | Supplies data via PRs; may make mistakes or be compromised. Never runs code.        |
| Agent / platform developer | trusted, fallible | One shared GitHub account (Q10.6); roles separated by process, not identity.        |
| CI                         | trusted           | GitHub Actions; reads secrets only in deploy jobs (later).                          |
| Third-party providers      | external          | npm registry, Actions marketplace, email provider, hosting, optional map/analytics. |

## Threats and mitigations

| #   | STRIDE                      | Threat                                                                                   | Mitigation                                                                                                                                                                                                       | Verified by                                                         |
| --- | --------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| T1  | Tampering / EoP             | Tenant content injects script (XSS) via Markdown, YAML strings or URLs                   | Strict Zod schemas, unknown keys rejected; Markdown through an allow-list sanitizer, no raw HTML; URL schemes `https:`, `mailto:`, `tel:` only; `tenant-guard` content rules; strict CSP without `unsafe-inline` | `tenant-guard` tests (M1); XSS payload tests on built pages (M5)    |
| T2  | EoP                         | Tenant adds code or dependencies (package.json, scripts, import maps, CDN scripts)       | Single dependency root; `tenant-guard` forbids package/lock/config files, non-allow-listed file types, symlinks, module syntax and external script/style/font URLs                                               | `tenant-guard` tests (M1)                                           |
| T3  | Info disclosure / Tampering | One tenant's build reads another tenant's files or secrets (B3)                          | Build per tenant in its own process, path allow-list (`tenants/<slug>/` + `packages/`), per-tenant env vars only; no symlinks in tenants                                                                         | Isolation test in CLI (M5)                                          |
| T4  | Tampering                   | Malicious asset (polyglot image, SVG with script, oversized file)                        | MIME + extension allow-list, size limits, image re-encoding, EXIF strip, SVG disallowed until sanitized, fonts WOFF2 only                                                                                        | Asset pipeline tests (M5)                                           |
| T5  | Spoofing / DoS              | Form spam, abuse or flooding of functions                                                | Honeypot + privacy-friendly CAPTCHA, rate limits per IP and per tenant, body size limits, generic errors                                                                                                         | Function tests (M7)                                                 |
| T6  | Tampering                   | CSRF on state-changing endpoints                                                         | Origin/Referer check against tenant origin + per-form token; `SameSite` where cookies exist                                                                                                                      | Function tests (M7)                                                 |
| T7  | Info disclosure             | PII from forms leaks via logs, errors or webhooks                                        | Minimum PII, stated retention, no PII in logs (structured logger with redaction), webhook payload documented; HTTPS-only webhook targets                                                                         | Function tests + log redaction test (M7)                            |
| T8  | Info disclosure (privacy)   | Third-party requests before consent (fonts, maps, analytics) leak visitor IPs (GDPR/LEK) | Self-hosted fonts; click-to-load map; analytics only via cookieless adapter after consent; CSP allow-lists only enabled adapters                                                                                 | `tenant-guard` (M1); built-page origin check (M5); a11y-perf audits |
| T9  | Spoofing                    | Clickjacking / framing of tenant sites                                                   | `frame-ancestors 'none'`, COOP/CORP                                                                                                                                                                              | Header tests (M5)                                                   |
| T10 | Tampering (supply chain)    | Compromised npm package or install script                                                | One lockfile, `--frozen-lockfile`, exact pins, `onlyBuiltDependencies: []`, `pnpm audit`, license check, SBOM, Dependabot, `type:dependency` review by architect + security                                      | `security.yml` (M1)                                                 |
| T11 | Tampering (supply chain)    | Compromised or moved GitHub Action tag                                                   | Least-privilege `permissions:`, `persist-credentials: false`, no `pull_request_target`; **actions still pinned by tag, not SHA** (open finding)                                                                  | Workflow review (security)                                          |
| T12 | Info disclosure             | Secrets committed to the repo                                                            | `.gitignore` for `.env*`, `.env.example` only, gitleaks on every push/PR                                                                                                                                         | `security.yml` (M1)                                                 |
| T13 | Repudiation / EoP           | Agent merges without required reviews, or self-approves (one shared account)             | `review-gate` + `touches-guard` checks, signed APPROVED comments, Orchestrator verification; **no branch protection on current plan** (open finding)                                                             | `pr-gates.yml` (M1)                                                 |
| T14 | Tampering                   | Webhook adapter used for SSRF (tenant-configured URL to internal addresses)              | HTTPS only, block private/link-local/loopback ranges after DNS resolution, timeout, no redirects                                                                                                                 | Adapter tests (M7)                                                  |
| T15 | DoS                         | Build-time resource exhaustion from huge content or images                               | Size limits per file and per tenant, build timeouts in CI                                                                                                                                                        | CLI tests (M5)                                                      |

## Open findings at M1

1. **Actions pinned by tag, not commit SHA** (T11). Severity: medium. Fix: pin every `uses:` to a full SHA with a version comment; let Dependabot update them. Must be fixed before: M5.
2. **No branch protection** (T13). Severity: medium. Fix: upgrade plan or make the repo public, then require PRs and the `ci`, `pr-gates` and `security` checks on `main`. Must be fixed before: M2 work merges.
3. **Code scanning (CodeQL) unavailable on this private repo** (T10). Severity: medium. Fix: enable GitHub Code Security and set `CODE_SCANNING_ENABLED=true`. Must be fixed before: M7.

Out of v1 scope (re-model when added): payments, online ordering, accounts/admin UI, CMS.
