# sc-saas-e2e — CLAUDE.md

**End-to-end test suite** for SanchiSaaS. Playwright + TypeScript, driving the member PWA (`sc-saas-frontend`) and the admin panel (`sc-saas-admin`) against a real, deployed QA tenant, with a few direct calls to the backend API (`sc-saas-backend`). This is the 8th repo in the workspace. See the workspace `../CLAUDE.md` for cross-repo invariants, and `knowledge.md` here for the app behaviours the suite depends on.

`README.md` is the human guide (setup, secrets, adding a journey). This file holds the rules for agents.

## Stack & commands

Node ≥ 20 · `@playwright/test` · TypeScript · `dotenv` · `tsx`. Default branch **`main`** (not `ai_native_setup`). No product code lives here.

- install: `npm ci && npx playwright install chromium`
- type-check: `npm run typecheck`. Run this before every commit.
- run: `npm test`, `npm run test:smoke`, `npm run test:cfa`, `npx playwright test <file> --project=<p> [--no-deps]`
- seed QA accounts: `npm run seed` (idempotent)
- environment: `E2E_ENV=development|staging|production` (default `development`)

## Hard rules

1. **Never read, print or grep `.env.*` files.** They hold real credentials, and the user's permission settings deny it. Playwright loads them at runtime: just run the tests. New keys go in `env.example` (empty or placeholder values), the env block of `.github/workflows/e2e.yml`, and the README secrets list.
2. **Production is read-only.** Anything that creates or changes data is tagged `@write`, and `playwright.config.ts` skips it when `E2E_ENV=production`. Every new writing test must carry `@write`.
3. **Never UI-login a seeded member inside a journey.** The QA tenant enforces single-session login, so a new login kills the saved session that other tests are using. Use `asRole('<role>')` from `fixtures/auth.ts`. The only UI logins are in the `login` project (`tests/frontend/login-otp.spec.ts`, which runs first) and in the setup files.
4. **Tests are tagged.** Use `@smoke` or `@regression`; `@frontend`, `@admin` or `@cfa`; the role (`@startup`…); and `@write`. Setup files carry every run tag (`@smoke @regression @cfa`), so `--grep` still logs in first. A new run tag must be added to the setup files too.
5. **Assert on the real request, not the toast.** Several PWA toasts fire before the HTTP call finishes. Use `page.waitForResponse(...)` and check `.ok()`.
6. **Never assert on global counts** (total leads, emails, users). Test data builds up until SAN-1613 (nightly reset) lands. Filter by your own run id or address.
7. **Commit and push only when the user asks.** Show the diff before pushing. Commit messages end with the `Co-Authored-By` line from the session's attribution reminder.

## Layout

```
config/       env.ts (E2E_ENV, URLs, env.cfa.*) · accounts.ts (roles, secrets, qaOtp, authFile)
fixtures/     auth.ts asRole() · cfa.ts (CFA program fixture + CfaAdmin + extended test) · email-log.ts · files/
pages/        page objects: frontend/ (LoginPage, RegisterPage, StartupProfilePage, cfa/*), admin/ (AdminLoginPage, cfa/*)
seed/         API seeding of the 8 member accounts
tests/        *.setup.ts / cfa.teardown.ts · frontend/ · admin/ · cfa/
```

## Project graph (playwright.config.ts)

```
login (login-otp.spec) ──► setup-frontend ──► frontend
setup-admin ─────────────────────────────────► admin
setup-admin ──► cfa-setup ──(teardown)──► cfa-teardown
setup-frontend + setup-admin + cfa-setup ──► cfa
setup-frontend + setup-admin ──► cross   (admin sets data up, PWA journey runs: one-on-one booking)
```

The `login` project runs before any session is saved, for the single-session reason in hard rule 3. A broken admin login doesn't block the PWA tests, and the reverse holds too.

## Environments

| `E2E_ENV` | Branch it tests | QA tenant | Writes |
|---|---|---|---|
| development | `ai_native_setup` | `thub.sanchidev.in` / `adm.thub.sanchidev.in` / `api.thub.sanchidev.in` | yes |
| staging | `stagingdemo` | `demo.sanchiapp.com` / `adm.demo.sanchiapp.com` / `api.demo.sanchiapp.com` | yes |
| production | `main` | not created yet | no |

CI (`.github/workflows/e2e.yml`) runs nightly against development and on demand (`workflow_dispatch`). Secrets live in GitHub **Environments** named after `E2E_ENV`.

## Linear

- Project **QA Automation and Acceptance** (P-SAN-76): SAN-1575 … SAN-1622, owner Ritu Raj.
- **CFA E2E Regression Suite (FT-006)** (P-SAN-83): SAN-1879 … SAN-1885. Spec: `../specs/features/FT-006-cfa-e2e-regression-suite.spec.md`.
- Bugs the suite finds go to the **Enhancement** project, milestone **`QA_Automation_Bugs-Found`**. The test that found the bug is marked `test.fail()` (known-failing) until the fix ships.
