# sc-saas-e2e

End-to-end tests for SanchiSaaS: the member PWA (`sc-saas-frontend`) and the admin panel (`sc-saas-admin`), written with Playwright and TypeScript.

Part of the Linear project **QA Automation and Acceptance**. Owner on the ground: Ritu Raj.

---

## Test environments

There is one environment per deployed branch. Each has its own QA tenant and its own seeded accounts. Testing runs in this order: **development first**, then staging, then production.

| `E2E_ENV` | Branch | Deployed on | QA tenant (member PWA / admin / API) | Writes data? |
|---|---|---|---|---|
| `development` (default) | `ai_native_setup` | sanchidev.in | `https://thub.sanchidev.in` / `https://adm.thub.sanchidev.in` / `https://api.thub.sanchidev.in` | yes |
| `staging` | `stagingdemo` | production AWS, via Jenkins (cockpit `api.tenants.sanchiconnect.com`) | `https://demo.sanchiapp.com` / `https://adm.demo.sanchiapp.com` / `https://api.demo.sanchiapp.com` | yes |
| `production` | `main` / `master` | production AWS, via Jenkins | _to be created_ | **no**: tests tagged `@write` are skipped (`playwright.config.ts`) |

Decided 12 Oct 2026 (SAN-1581). The old staging cockpit `api-dev.tenants.sanchiconnect.com` returns 502 and isn't used.

A code change reaches each environment by moving from branch to branch: `ai_native_setup` → `stagingdemo` → `main`. A backend fix that the suite depends on, such as SAN-1864, has to be deployed to an environment before that environment's run can go green.

In SanchiSaaS a tenant is a **deployment**, not just a database row, because each tenant runs its own backend. Creating a QA tenant on staging or production therefore takes:
1. an `organizations` row in the tenants DB,
2. a `tenant_users` row pointing at it (both via `sanchiconnect-saas-tenants-admin`),
3. a backend deployment for that tenant,
4. DNS and hosting for the frontend and admin panel.

### QA tenant settings the suite relies on

| Setting | Value | Why |
|---|---|---|
| `email_otp_verification` | on | the login page only shows the email field when this is on |
| `mobile_otp_verification` | off | otherwise registration also demands a verified mobile number |
| `sso_login_enabled` | off | admin login uses email + password |
| Fixed OTP for QA accounts | enabled **on the QA backend only** | see "Logging in without a real inbox" below |

### Logging in without a real inbox

Every member login is an OTP. The QA backend issues a **fixed OTP** for the seeded accounts, so no inbox is needed ([SAN-1864](https://linear.app/sanchiconnect/issue/SAN-1864)). Set these on the **QA tenant's backend deployment only**:

| Backend env var | Value |
|---|---|
| `QA_FIXED_OTP_EMAILS` | comma-separated list of every `QA_*_EMAIL` member address |
| `QA_FIXED_OTP` | 4 digits, no leading zero. The same value goes in this repo's `QA_OTP` secret. |

If either variable is unset or blank, that deployment has no bypass, which is the default on every other tenant. This replaced the old hardcoded `PenetrationTestingEmails` list (always `1234`), which was live on production and **no longer works anywhere** once SAN-1864 is deployed.

The backend compares the submitted code against an md5 hash. The PWA hashes the OTP before sending it, and so does `seed/api.ts`; anything that calls `/otp_verifications/verify` directly must do the same.

---

## Quick start

```bash
npm ci
npx playwright install chromium

cp env.example .env.development      # dev values are pre-filled; add admin/jury (git-ignored)
npm run seed                         # create any missing QA accounts (E2E_ENV=development)
npm test                             # run everything against development
npm run test:smoke

E2E_ENV=staging npm run test:smoke      # needs .env.staging
E2E_ENV=production npm run test:smoke   # needs .env.production; read-only
npm run report                   # open the last HTML report
```

`E2E_ENV` defaults to `development`. Settings are read from `.env.<E2E_ENV>` locally and from GitHub secrets in CI.

## Secrets

Never put a credential in this repo, in Linear, or in a PR description.

In GitHub, go to **Settings → Environments** and create three environments: `development`, `staging` and `production`. Add every variable from [`env.example`](env.example) as a secret of the same name in each:

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

- **nightly** at 02:00 IST against `development`, with the full suite,
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
  frontend/login-otp.spec.ts  the login journey; runs first (project "login")
  frontend.setup.ts  logs in once per member account → .auth/<role>.json
  admin.setup.ts     logs in once as admin and jury  → .auth/<role>.json
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
4. **Start logged in.** Call `asRole('<role>')` inside the `describe`. Skip the block when the role's secret isn't set, as `tests/frontend/seeded-accounts.spec.ts` does. **Never log in through the UI inside a journey.** The dev tenant enforces single-session login, so a new login for a seeded account kills the saved session that other tests are using. The only UI logins are in `login-otp.spec.ts`, which runs before any session is saved, and in the setup files.
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
4. Tests that write run on development and staging; only read-only tests run on production.
5. An escaped defect gets a test before its fix merges.

## Nightly reset plan (SAN-1613)

The goal is a known starting state each morning for journeys that register, apply or book.

1. **Seed:** a scheduled job in this repo's CI (before the nightly run) calls `npm run seed` plus seed steps for one program with an open round, one event with slots and one pitch file. Everything goes through the API.
2. **Reset:** before seeding, delete what the previous night's tests created. Test-created data is recognisable by a `qa+run-<id>` email prefix and a `[QA]` name prefix. **Open question:** this needs either a QA-only cleanup endpoint on the backend or a DB truncate step in the deploy workflow. That's decided in SAN-1613, because no deploy workflow exists yet.
3. **Done when:** the suite passes on the first run of the morning three days running.
