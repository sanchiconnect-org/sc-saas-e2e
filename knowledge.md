# sc-saas-e2e — Knowledge (as-is)

Last updated: 2026-10-12
Source: building and running this suite against development (`thub.sanchidev.in`) and staging (`demo.sanchiapp.com`) on 2026-10-12, plus code reads in the product repos (paths cited). Each fact below was observed in a real run, or read in code where marked `[code]`.

This file records **what the product does that the tests depend on**. When a product repo changes one of these, the matching test breaks. That makes this the e2e repo's "contracts consumed" list.

---

## 1. Tenant, login and accounts

- **Tenant resolution.** The PWA calls the cockpit `GET {cockpit}/api/v1/public/global/resolve-domain/{hostname}` (`sc-saas-frontend` `core/service/tenant.service.ts`) and gets back `apiUrl` and `features`.
  - Cockpits: dev `https://api.tenants.sanchidev.in`; staging and production `https://api.tenants.sanchiconnect.com`. The old `api-dev.tenants.sanchiconnect.com` is dead (502).
  - The cockpit only resolves hostnames on its **registered-domains list** (SAN-557); any other host gets `403 Direct access is not allowed` and the PWA renders blank. `aaf.thub.sanchidev.in` is not registered on dev, which is why journey 8 needs `SPOKE_URL`.
  - `features` does **not** include `jury_nda_enabled` or `single_session_login_enabled` `[code: sanchiconnect-saas-tenants global.service.ts]`.
- **Login settings the suite relies on.** The QA tenants have email OTP on, mobile OTP off, SSO off. The email field on `/auth/login` only renders when `email_otp_verification` is on.
- **OTP.**
  - The PWA and the seed send `md5(code)` to verify endpoints. The backend compares against the stored hash without re-hashing `[code: verifications.service.ts]`.
  - The 4-box `ng-otp-input` only reacts to real key events: click the first box, then `keyboard.type`. `fill()` leaves Submit disabled.
- **Fixed OTP for QA.** Backend env on the QA deployment only:
  - `QA_FIXED_OTP_EMAILS` is a comma list. Exact entries plus local-part wildcards are allowed, e.g. `sc_reg_*@yopmail.com`, `sc_cfa_*@yopmail.com` (SAN-1877). A `*` in the domain, or a local part made only of `*`, is ignored.
  - `QA_FIXED_OTP` is 4 digits with no leading zero.
  - Email-type OTPs only. Unset means no bypass. The hardcoded `PenetrationTestingEmails` list was removed (SAN-1864).
- **Rate limits (10 per 60 s).** They apply to `mobile/login`, `otp_verifications/send` and `/verify`, `auth/register`, and the CFA apply route. One full run makes about 10 logins, so `LoginPage.requestOtp` waits 61 s and retries once on a 429.
- **Single-session login** is on for the QA tenant (`jwt.strategy.ts:37` `[code]`): a new login invalidates that user's older session.
- **Where each role lands after login.**
  - `/startups/dashboard`, `/investors/dashboard`, `/corporates/dashboard`, `/mentors/dashboard`, `/partners/dashboard`
  - `/service-provider/dashboard` (singular)
  - `/individuals/dashboard`, `/program-office-members/dashboard`
- **Accounts.**
  - The 8 members are `sc_<role>@yopmail.com`, created by `npm run seed` through `public/otp_verifications/send` → `/verify` → `public/auth/register` with `userType`.
  - Admin and jury are created by hand in the admin panel. Use our own domain for them, never yopmail: a public inbox would allow password-reset takeover.
  - The admin needs `can_broadcast_messages` for the email-log page.

## 2. PWA journeys

| Journey | What the test depends on |
|---|---|
| Register (`/auth/register`) | Step 0: radio `input[name=userType][value=startup]`, `button.next-button`. Step 1: `#companyName`, `#name`, `#email` (duplicate check `GET public/auth/verify/email/:email` about 1 s after typing), `#termsAndCondition`. The email must be lowercase with no `+`. **The OTP boxes appear before the wizard sends the email OTP (~1 s later)**: wait for the `send` POST, or `/verify` returns 404 `VERIFICATION_NOT_FOUND`. Registration then calls `POST public/auth/register` and lands on `/startups/dashboard` or `/startups/edit/startup-information`. A localStorage key `skip-first-login-modal=true` suppresses the dashboard modal. |
| Profile auto-save | `/startups/edit/startup-information`, `#companyName`. The save is a debounced (~800 ms) `PATCH /startups/startup-information`. The "Changes saved automatically" toast fires **before** the request completes. `yearOfIncorporation` defaults to the current year, so it's always valid. |
| Pitch upload | `/startups/edit/pitch-deck-documents`, hidden `input#fundraising-pitchRef`, `POST /startups/pitch-deck/upload/pitch-file`. The backend checks magic bytes, so the fixture is a real PDF (`fixtures/files/qa-pitch-deck.pdf`). The file is listed in a table cell under the "Your pitch deck" heading. **The PWA dashboard does not show the pitch deck.** Image conversion is async (polled every 30 s) and outside the pass bar. |
| Email logged | Admin `/email_logs/list?recipient=…&template_code=verify-email-address`, rows `tbody#filteredData tr[recordId]`, `data-db-status="sent"`. OTPs are masked as `******` in the stored subject. |

**No `data-testid` exists outside the login screens.** Use ids, names, roles and text. Adding test ids is an app-side follow-up, listed in FT-006.

## 3. Admin panel

- **Login:** `{ADMIN_URL}/auth/login`, `#inputEmail`, `#inputPassword`, the "Sign in" button. The jury lands on `/jury/dashboard`. The dashboard `<title>` starts with "Admin Panel", and the greeting `h4` contains "Your IP is".
- **Mutations.** Every mutation is a jQuery AJAX POST to the **same page URL** with `submitAction=<name>` on the PHP session cookie. Most have no CSRF check. The response is JSON with **HTTP 200 even on error** (`{error, success, …}`), and on dev it is often preceded by inline PHP warnings. `CfaAdmin.submitAction` strips the warnings and throws on `error:true`.
- **DB errors are silent.** The connection uses `PDO::ERRMODE_SILENT`, and Medoo returns the statement even when `execute()` fails. A "success" page can therefore hide a failed write (that's how SAN-1865 was missed). Assert the result: reload, read back, or query the API.
- **Search** does an exact match, not a substring match, when the term contains `[ ]`, `_`, `*` and similar. Search `CFA run-`, not `[QA] CFA run-`.

## 4. Custom programs (CFA): FT-006

- **Isolation primitive: test mode.** `changeTestMode` sets `test_mode_enabled=1` **and** `status=1`.
  - Test-mode programs are hidden from every program list, counter and cron, but `/programs/apply/{code}/{slug}` still opens.
  - The PWA ignores closed and deadline state in test mode. "Closed blocks apply" is therefore tested on the long-lived `[QA] CFA Closed` program (D9).
- **Per-run program.** `fixtures/cfa.ts` `createCfaProgram()`:
  1. create (`table.php` `createApplicationProgram`)
  2. `importFieldsFromForm` (template form)
  3. `editProgram` (re-application immediate)
  4. `createProgramRound` ×N
  5. test mode on
  6. make live

  Teardown deletes it, plus any `[QA] CFA run-*` program older than 24 h. The age comes from the run id in the title, because the admin list has no created date.
- **Deletion** hard-deletes the program, form, submissions, rounds, ratings and jury. It leaves leads, documents, analyses, notifications, S3 objects and email logs. **It is refused if the program has any Jury NDA rows**, so NDA tests only use the long-lived `QA_CFA_NDA_PROGRAM_ID` program.
- **Fast seeding.** `import_applications_csv` → `moveToSubmitted` (`CfaAdmin.seedSubmittedApplications`).
- **Program states (P2).**
  - A new program (`createApplicationProgram`) is a draft: `status=0`, test mode off, an empty unpublished form. The wizard's finalize step then shows "ready to go live" with **Go Live**.
  - `changeTestMode enable` also sets `status=1`, which hides Go Live. So a draft can't be in test mode, and the wizard never offers Go Live on a test-mode program. The P2 Go Live test switches test mode on in the instant before the Go Live request reaches the server, so the program is never listed.
  - The backend's `GET application-programs-management/code/{code}` returns any program, live or not. Its `form` is only set once the form is published (`forms.status=1`, done by `makeProgramLive`).
  - **Close / Re-open Applications** and **Close Program** buttons render for developer and super-admin roles only. The dev QA admin has them.
  - `reopenProgramApplications` also forces `allow_re_application`, `auto_communication` and `editable_jury_ratings` to 1, even when the admin had them off (observed on dev).
  - Every wizard button reloads or redirects the page 0.5–1 s after a success. Wait for that reload before the next `goto`, or the `goto` is aborted.
- **Admin program list tabs** (Draft / Live / Ongoing Evaluation / Closed) are `?conditions=` links. **The search box can't be combined with Live or Ongoing Evaluation**: `table.php` puts the search terms into the same `OR` as those tabs' deadline rule, so every program that matches the search shows under both tabs. The search is also sticky (kept in the PHP session, and an empty term keeps the previous one). `CfaAdmin.listProgramsInTab` works around this.
- **Rounds.**
  - `createProgramRound` does **not** enforce unique names, and the round table has no unique index.
  - Required-field checks are written `trim(($_POST['x']) == "")`, which never trims, so a whitespace-only round title is accepted and stored empty. The same pattern is in most admin handlers.
  - `deleteRound` is a soft delete (`status=0`); `getProgramRounds` lists live rounds only.
  - The round editor (`edit_program_round/{id}?section=settings`) is a plain form post (`editRound`), and the page re-renders with a success or error alert.
- **Form builder.**
  - Adding one field posts `saveForm` 3–5 times, some of them concurrently, each 500 ms after its trigger. Only the save that carries the new field's title is the one to wait for.
  - Every `saveForm` writes a version (`spa_admin_logs`). The newest version is "Current" and has no Restore button.
  - `importFieldsFromForm` logs the form's **previous** fields, not the imported ones. After an import, the "Current" card holds the pre-import fields.
  - Saved fields can be read from the builder page itself: each is rendered as `addFieldToSection(<section>, "<field JSON>")` (`CfaAdmin.formFields`).
  - **`/form-management/versions/{formId}` has no login check** (`versions.php` never calls `checkLoggedIn()`). An anonymous GET lists a form's versions with admin names, and an anonymous `restoreForm` POST overwrote a form's fields on dev.
- **PWA apply page.** When `localStorage['application-{programUuid}']` holds an email, the page opens straight on the application form and skips the lead modal. `ProgramApplyPage.useGuestIdentity` uses this to look at the form without the OTP.
- **Known product bugs.** Tests for these are marked `test.fail()`. Remove `test.fail()` when the fix ships and the test "unexpectedly passes".
  - **SAN-1878:** "Tentative" on a CFA application always fails. The backend has no `tentative-round` route.
  - **SAN-1886:** the CFA apply API accepts applications to closed, past-deadline or unpublished programs. Enforcement exists only in the PWA.
  - **Pending filing (found by P2, 2026-10-12):** duplicate round names are accepted, and so are whitespace-only round titles. Each has a `test.fail()` in `tests/cfa/p2-program-setup.spec.ts`.
- **Excluded from automation:**
  - AI analysis beyond page loads (real LLM spend, no mock)
  - payments
  - AI voice agent (real billed calls)
  - program promotion (writes the main tenants DB)
  - invite or move to community
  - Kanban drag-and-drop is flaky: use the table view's "Move to round".

## 5. Data that accumulates (until SAN-1613)

Each run leaves data on the QA tenant:
- one `sc_reg_<timestamp>@yopmail.com` startup from the register journey;
- OTP verification rows and email-log rows;
- CFA leads, notifications and documents;
- the seeded startup's company name and pitch deck are overwritten.

SAN-1613 (nightly reset) is the cleanup plan.

## 6. Bugs found by building this suite

| Issue | Repo | Summary | Status (2026-10-12) |
|---|---|---|---|
| SAN-1864 | backend | Hardcoded fixed OTP `1234` was live on every tenant, production included → env-gated | fixed on dev; production deploy pending |
| SAN-1865 | admin | Add/Edit Admin failed silently when jury NDA was on (role column posted into `spa_admin_users`) | Done |
| SAN-1877 | backend | Wildcard support in `QA_FIXED_OTP_EMAILS` | Done |
| SAN-1878 | backend | CFA Tentative has no backend route | Todo (Sandeep) |
| SAN-1886 | backend | CFA apply ignores closed, deadline and unpublished state | Todo (Sandeep) |
