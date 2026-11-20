# Security policy

## Reporting a vulnerability

Please **don't open a public issue**. Report it privately through GitHub: **Security → Report a vulnerability** on this repository (GitHub private vulnerability reporting).

Include the affected path or tenant, steps to reproduce and the impact you expect. We aim to acknowledge reports within 3 working days and to agree a fix timeline with you within 10 working days.

## Scope

In scope: everything in this repository: the platform packages, the `pwp` CLI, the serverless functions, CI workflows and the generated tenant sites.

Out of scope: third-party providers (hosting, email), and findings that require a compromised developer machine or GitHub account.

## Supported versions

Only the latest commit on `main` is supported. All tenants build from the same platform commit (Q2.2).

How the platform is secured is described in [`docs/SECURITY.md`](docs/SECURITY.md) and [`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md).
