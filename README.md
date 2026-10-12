# sc-saas-e2e

End-to-end tests for SanchiSaaS: the member PWA (`sc-saas-frontend`) and the admin panel (`sc-saas-admin`), written with Playwright and TypeScript.

Part of the Linear project **QA Automation and Acceptance**. Owner on the ground: Ritu Raj.

---

## Test environment

> **Decision status: PENDING** ([SAN-1581](https://linear.app/sanchiconnect/issue/SAN-1581)). Record the decision here when it's made: the date, who made it, and why.

The rule from the project: use a **staging environment** if one exists. Otherwise use a **dedicated QA tenant on production** that holds no real users and no real data. Either way there is one QA tenant per environment.

What we know as of 12 Oct 2026:

- There is no `docs/DEPLOYMENT.md` in any repo.
- The frontend's staging build points at the cockpit `https://api-dev.tenants.sanchiconnect.com`. That host **returns 502**, so there is no working staging right now.
- In SanchiSaaS a tenant is a **deployment**, not just a database row. Each tenant runs its own backend. Creating the QA tenant takes:
  1. an `organizations` row in the tenants DB,
  2. a `tenant_users` row pointing at it (both via `sanchiconnect-saas-tenants-admin`),
  3. a backend deployment for that tenant,
  4. DNS and hosting for the frontend and admin panel.

How the suite behaves in each environment:

| `E2E_ENV` | Runs | Writes data? |
|---|---|---|
| `staging` | the full suite | yes |
| `production` | the QA tenant on production | **no**: tests tagged `@write` are skipped (`playwright.config.ts`) |

### QA tenant settings the suite relies on

| Setting | Value | Why |
|---|---|---|
| `email_otp_verification` | on | the login page only shows the email field when this is on |
| `mobile_otp_verification` | off | otherwise registration also demands a verified mobile number |
| `sso_login_enabled` | off | admin login uses email + password |
| Fixed OTP for QA accounts | enabled **on the QA backend only** | see "Logging in without a real inbox" below |

### Logging in without a real inbox

Every member login is an OTP. Today the backend accepts the fixed OTP `1234` only for a hardcoded list of 5 addresses (`PenetrationTestingEmails`). That list is active on **every** tenant, production included, so we must not extend it.

The prerequisite is a backend change that reads the fixed-OTP addresses from an environment variable. The variable is set only on the QA deployment and empty everywhere else. Until that ships, seeding and member login can only use those 5 legacy addresses.

---

## Quick start

```bash
npm ci
npx playwright install chromium

cp env.example .env.staging      # fill in URLs + QA accounts (git-ignored)
E2E_ENV=staging npm run seed     # create any missing QA accounts
E2E_ENV=staging npm test         # run everything
E2E_ENV=staging npm run test:smoke
npm run report                   # open the last HTML report
```

`E2E_ENV` defaults to `staging`. Settings are read from `.env.<E2E_ENV>` locally and from GitHub secrets in CI.

## Secrets

Never put a credential in this repo, in Linear, or in a PR description.

In GitHub, go to **Settings → Environments** and create two environments, `staging` and `production`. Add every variable from [`env.example`](env.example) as a secret of the same name in each:

- `FRONTEND_URL`, `ADMIN_URL`, `API_URL` (without `/api`)
- `QA_OTP`
- `QA_<ROLE>_EMAIL` for: `STARTUP`, `INVESTOR`, `CORPORATE`, `MENTOR`, `PARTNER`, `SERVICE_PROVIDER`, `INDIVIDUAL`, `PROGRAM_OFFICE`
- `QA_ADMIN_EMAIL` / `QA_ADMIN_PASSWORD`, `QA_JURY_EMAIL` / `QA_JURY_PASSWORD`

If a role's secret is missing, that role's tests are **skipped**, not failed. Check the skip count in the report.

## Seeded accounts

| Account | Created by | Logs in with |
|---|---|---|
| Startup, Investor, Corporate, Mentor, Partner, Service Provider, Individual, Program Office | `npm run seed`, through the backend API (send OTP → verify → `POST /api/v1/public/auth/register`) | email + OTP on the PWA |
| Admin | once, by hand, in the QA tenant's admin panel (Admins page). The backend has no API for admin users. | email + password on the admin panel |
| Jury | same as Admin, with the jury role | email + password, lands on `/jury/dashboard` |

`seed/seed.ts` is idempotent: an email that already exists is skipped. The seed is the only way test data is created.

## CI

`.github/workflows/e2e.yml` runs:

- **nightly** at 02:00 IST against `staging`, with the full suite,
- **on demand** via *Actions → e2e → Run workflow*, where you choose the environment and a tag (default `@smoke`).

CI retries a failed test once. A test that passes only on the retry is reported as **flaky**. Quarantine it the same day with a Linear issue; never re-run until green.

The HTML report is attached to every run, and traces, screenshots and videos are attached on failure. Wiring the suite to frontend and admin PRs is SAN-1577.

## Layout

```
config/       env.ts (which environment, URLs) · accounts.ts (roles, secrets, OTP)
fixtures/     auth.ts — asRole('investor') starts a test already logged in
pages/        Page Objects: frontend/ (PWA) and admin/ (admin panel)
seed/         API seeding of the QA tenant
tests/
  auth.setup.ts   logs in once per seeded account → .auth/<role>.json
  frontend/       PWA journeys   (project "frontend", baseURL = FRONTEND_URL)
  admin/          admin journeys (project "admin",    baseURL = ADMIN_URL)
```

## Adding a journey

1. **Pick the folder.** Use `tests/frontend/` for the PWA and `tests/admin/` for the admin panel. Write one journey per spec file, named after what the user does, e.g. `apply-to-program.spec.ts`.
2. **Write the header.** It names the journey, its **owner** (who fixes it when it fails) and its pass bar.
3. **Tag it.**
   - Run tier: `@smoke` or `@regression`.
   - Repo: `@frontend` or `@admin`.
   - Stakeholder type, e.g. `@investor`.
   - `@write` if it creates or changes data, so it never runs against production.
4. **Start logged in.** Call `asRole('<role>')` inside the `describe`. Skip the block when the role's secret isn't set, as `tests/frontend/seeded-accounts.spec.ts` does.
5. **Use Page Objects** from `pages/`. Selectors live there, not in specs. Prefer `data-testid`, then roles and labels; never long CSS chains. If an element has no stable selector, add a `data-testid` in the app repo.
6. **Record the first draft (optional).** `npx playwright codegen <FRONTEND_URL>` records clicks. Move what it records into Page Objects.
7. **Run it 3 times locally:** `npx playwright test <file> --repeat-each=3`. Then run `npm run typecheck`.
8. **Open a PR.** Tests are code and are reviewed like code.

Example (illustrative — the selector is a placeholder):

```ts
import { expect, test } from '@playwright/test';
import { memberAccount } from '../../config/accounts';
import { asRole } from '../../fixtures/auth';

/** Journey: investor opens a startup profile. Owner: <name>. Pass bar: profile header visible. */
test.describe('investor views a startup', { tag: ['@regression', '@frontend', '@investor'] }, () => {
  test.skip(!memberAccount('investor'), 'QA_INVESTOR_EMAIL not set');
  asRole('investor');

  test('opens the first startup in search', async ({ page }) => {
    await page.goto('/search/startups');
    // ...
    await expect(page.getByTestId('startup-profile-header')).toBeVisible();
  });
});
```

## Rules the suite lives by

1. A flaky test is quarantined the same day with an issue, never re-run until green.
2. Every journey has one owner, and the owner fixes it when it fails.
3. The smoke suite runs in under 10 minutes.
4. Tests that write run against staging, and only read-only tests run on production.
5. An escaped defect gets a test before its fix merges.

## Nightly reset plan (SAN-1613)

The goal is a known starting state each morning for journeys that register, apply or book.

1. **Seed:** a scheduled job in this repo's CI (before the nightly run) calls `npm run seed` plus seed steps for one program with an open round, one event with slots and one pitch file. Everything goes through the API.
2. **Reset:** before seeding, delete what the previous night's tests created. Test-created data is recognisable by a `qa+run-<id>` email prefix and a `[QA]` name prefix. **Open question:** this needs either a QA-only cleanup endpoint on the backend or a DB truncate step in the deploy workflow. That's decided in SAN-1613, because no deploy workflow exists yet.
3. **Done when:** the suite passes on the first run of the morning three days running.
