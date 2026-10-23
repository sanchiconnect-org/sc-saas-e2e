# sc-saas-e2e — Knowledge (as-is)

Last updated: 2026-10-23 (SAN-1959 applicant token: `[code]` facts, not yet observed in a run)
Source: building and running this suite against development (`thub.sanchidev.in`) and staging (`demo.sanchiapp.com`) on 2026-10-12, plus code reads in the product repos (paths cited). Each fact below was observed in a real run, or read in code where marked `[code]`.

This file records **what the product does that the tests depend on**. When a product repo changes one of these, the matching test breaks. That makes this the e2e repo's "contracts consumed" list.

---

## 1. Tenant, login and accounts

- **Tenant resolution.** The PWA calls the cockpit `GET {cockpit}/api/v1/public/global/resolve-domain/{hostname}` (`sc-saas-frontend` `core/service/tenant.service.ts`) and gets back `apiUrl` and `features`.
  - Cockpits: dev `https://api.tenants.sanchidev.in`; staging and production `https://api.tenants.sanchiconnect.com`. The old `api-dev.tenants.sanchiconnect.com` is dead (502).
  - The cockpit only resolves hostnames on its **registered-domains list** (SAN-557); any other host gets `403 Direct access is not allowed` and the PWA renders blank. `aaf.thub.sanchidev.in` is not registered on dev, which is why journey 8 needs `SPOKE_URL`.
  - `features` does **not** include `jury_nda_enabled` or `single_session_login_enabled` `[code: sanchiconnect-saas-tenants global.service.ts]`.
  - **Same builder as verify_tenant.** `GET …/public/global/verify_tenant/{hostname}` returns the same 9-key `data` shape (users 18, features 216). `GET …/public/global/tenant-settings/{hostname}` returns `{ features, settings, subscription_active, subscription_active_message, maintenance_mode }`. Black-box checks: `tests/api/tenant-contracts.spec.ts` (SAN-1609). Public responses must not carry secret values; `factacy_api_key` still leaks on tenant-settings (SAN-1941).
- **Login settings the suite relies on.** The QA tenants have email OTP on, mobile OTP off, SSO off. The email field on `/auth/login` only renders when `email_otp_verification` is on.
- **OTP.**
  - The PWA and the seed send `md5(code)` to verify endpoints. The backend compares against the stored hash without re-hashing `[code: verifications.service.ts]`.
  - The 4-box `ng-otp-input` only reacts to real key events: click the first box, then `keyboard.type`. `fill()` leaves Submit disabled.
- **Fixed OTP for QA.** Backend env on the QA deployment only:
  - `QA_FIXED_OTP_EMAILS` is a comma list. Exact entries plus local-part wildcards are allowed, e.g. `sc_reg_*@yopmail.com`, `sc_cfa_*@yopmail.com` (SAN-1877). A `*` in the domain, or a local part made only of `*`, is ignored.
  - `QA_FIXED_OTP` is 4 digits with no leading zero.
  - Email-type OTPs only. Unset means no bypass. The hardcoded `PenetrationTestingEmails` list was removed (SAN-1864).
- **Rate limits (10 per 60 s).** They apply to `mobile/login`, `otp_verifications/send` and `/verify`, `auth/register`, and the CFA apply route. One full run makes about 10 logins, so `LoginPage.requestOtp` waits 61 s and retries once on a 429. Since SAN-1959 the backend sets Express `trust proxy` (`TRUST_PROXY_HOPS`, default 1), so the limiter keys on the CI runner's own address instead of the reverse proxy's `[code: sc-saas-backend main.ts]`.
- **OTP limits (SAN-1959)** `[code: sc-saas-backend verifications.service.ts]`, in every `APPLICANT_TOKEN_MODE`:
  - **Send limit:** a 6th `send` for one email (or mobile number) within a rolling 60 minutes gets 429 `{ code: 'OTP_SEND_LIMIT' }`. It covers the member login OTP too. Addresses matching `QA_FIXED_OTP_EMAILS` are exempt, which is why the suite can fetch tokens freely for `sc_cfa_*` and the seeded members. Waiting a minute does not lift it, unlike the rate-limit 429.
  - **Attempt cap:** wrong codes are counted on the OTP row (`otp_verifications.attempts`). Wrong codes 1-4 get 409 "Invalid one time password"; the 5th gets 409 `{ code: 'OTP_TOO_MANY_ATTEMPTS' }`, and so does the right code afterwards. A new code must be sent.
  - Codes come from `crypto.randomInt`, still 4 digits.
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
- **PWA apply page.** When `localStorage['application-{programUuid}']` holds an email, the page opens straight on the application form and skips the lead modal. Since SAN-1959 it does so only with an unexpired `localStorage['applicant-token-{programUuid}']` (`{ token, expiresAt }`) too; with the identity alone it first opens the "Verify Your Email" OTP prompt (the check-status modal in verify mode, email locked) `[code: sc-saas-frontend program-public-apply.component.ts ensureApplicantToken]`. `ProgramApplyPage.useGuestIdentity` stores both, the token coming from the fixed OTP through the API.
- **Applicant token (SAN-1959)** `[code: sc-saas-backend applicant-or-owner.guard.ts, applicant-access.service.ts, applicant-token.service.ts]`.
  - **What it guards:** 21 applicant routes: `check_application_status/{email}[/details]`, `check_application_status_multiple`, `applied/{email}`, `fetch-documents[-rejected]`, `submit-document`, `update-document`, `delete-document`, `{uuid}/upload-document`, `{uuid}/{submissionId}/apply`, `users/profile-data/guest/{email}`, the four CFA payment lookups, `power-pitch/connect/call-for-applications`, `public/forms-management/submission/{formUUID}/fetch|submit|upload-file` (CFA forms only) and `cfa/upload-pitch-document`. Each accepts the `x-applicant-token` header or the owner's member JWT (cookie or Bearer).
  - **Issued by:** `public/otp_verifications/verify` when the body has `applicantProgramUUID` and the code is right (data gains `applicantToken`, `applicantTokenExpiresAt`); a bypass-OTP program's first form save (see Applicant flow); the admin "view as applicant" link. HS256, 120 minutes, never refreshed. Claims: `typ: cfa_applicant`, `email` (lower-cased), `programUUID`, `aud` (the tenant), and on the narrower form `sid` (one `forms_submissions.id`) + `src` (`created` | `admin`).
  - **Scope:** an email-scoped token covers every application of that email in that program; a `sid` token covers only that submission. A token for another program, another email or another submission is refused.
  - **`APPLICANT_TOKEN_MODE`** (backend env, read per request): `log` (default, also for unset or a typo) answers every request and logs a line for each one enforce would refuse; `enforce` answers 401 `{ code: APPLICANT_TOKEN_REQUIRED | APPLICANT_TOKEN_EXPIRED }` without a valid credential (a tampered token counts as none) and 403 `{ code: APPLICANT_NOT_OWNER }` when a valid one belongs to someone else or the resource doesn't exist; `off` checks nothing. From outside, `log` and `off` look the same. The suite detects `enforce` with one tokenless status call on an unknown email (`detectApplicantTokenMode`).
  - **Never a member login:** the token is signed with its own key and the JWT strategy rejects `typ: cfa_applicant`, so as Bearer or as the `accessToken` cookie it gets 401 on member routes.
  - **In every mode:** `update-document` refuses any `approvalStatus` but `submitted` (400; the check runs before the document lookup, so in `log` even a tokenless call gets 400, while in `enforce` the guard answers 401 first); `submit-document` refuses a document type of another program; a form save's body `userId` is kept only when it is the caller's own member id, and `isBackdoor` only with an admin-issued token.
  - Public forms of no application program (event forms) and payments of another `moduleType` are not checked at all.
- **Applicant flow (P3).**
  - **Apply** opens a modal (name, email; company and mobile only when the program asks for them). The modal upserts a lead as you type (`public/application-program-leads/upsert`, debounced ~1.5 s).
  - With OTP required, "Send Otp" posts `otp_verifications/send`, and "Submit" posts `/verify` with `md5(code)` and `applicantProgramUUID`; the applicant token from that response is stored and sent on every later applicant call (SAN-1959). With `bypass_otp_verification` on, or for a **logged-in member**, the modal has no OTP step and reads "Submit" from the start. Members still get the modal, pre-filled from their profile, and need no token (their cookie is the credential).
  - **Bypass-OTP programs, lazy OTP (SAN-1959 decision 1)** `[code]`: a new guest has no token. The draft fetch still goes out (in `enforce` it is refused silently), and the first save, which creates the row, is allowed without a token; its response data carries a `sid` token (`src: created`) for that row, which the PWA stores. A **returning** guest's tokenless first save would update an existing row: in `enforce` it gets 401 `APPLICANT_TOKEN_REQUIRED`, the page opens the "Verify Your Email" prompt, and after the OTP it loads the saved application. In `log` the save goes through as before.
  - On Submit the identity goes to `localStorage['application-{uuid}']`. A guest gets no user and no session, and its save carries no `userId`. A member's save carries its user id.
  - The form saves a draft (`submitted=false`) **as soon as it opens**, then every `autoSaveTimer` seconds (60 on the dev forms; 20 when unset). "Save as Draft" saves immediately. Reopening the page in the same browser fetches the draft by email and restores the answers.
  - "Submit Application" is disabled while a required field is empty. The red "n field(s) are not complete yet" badge marks the empty fields ("This field is required"). On submit, an "Are you sure?" dialog appears, then the save with `submitted=true`, then `POST application-programs-management/{uuid}/{submissionId}/apply`. The applicant then sees "Your details have been successfully submitted."
  - Apply creates the application's round row with **no round**. The admin's first move puts it in a round.
  - Guest file uploads work (`forms-management/submission/{formUUID}/upload-file`).
  - The `sc_cfa_*@yopmail.com` fixed OTP has been live on dev since 2026-10-13. Before that, `/verify` answered 409 "Invalid one time password" while `sc_reg_*` worked.
- **A field's visibility rule can hide it on the PWA.** The PWA shows a field only when its rule's `show` is empty/"null", its `field` is "none", or the rule matches. The builder's default rule for a new field (`{show:"show", field:null, condition:"is"}`, `edit-form.php`) never matches, so a field whose properties panel was never saved is **hidden** (known-failing test, bug pending filing). The dev `[QA] E2E template form` has one such field ("Enter Field Title"), so the per-run program's form shows **no fields** on the PWA. P3 throwaways get their own form via `CfaAdmin.saveFormFields`, whose fields use `field:"none"`.
- **Status view.** A returning applicant's page loads `POST application-programs-management/{uuid}/check_application_status/{email}/details` (`currentRoundId`, `isRejected`, `canReapplyNow`, …), with the applicant token (SAN-1959). `CfaAdmin.applicationStatus` makes the same call with a token from the fixed OTP. The check-status modal now sends the OTP first and reads the status after it (decision 5). The round tabs render only with `application_management_round_status_updates` on (off on dev), so with the flag off only the data can be checked. `?autoStatusCheck=true` only fills the identity for a logged-in member.
- **Re-apply after rejection (SAN-352).** A rejected applicant sees "Your previous application was rejected" and **Reapply Now**. That opens a blank form, whose saves carry `submissionId` = the rejected one. The backend edits that same row and the apply resets it to Submitted. No new row appears.
- **Resubmission.** `sendForResubmission` (posted to the detail page) mails `resubmit-application`, sets `forms_submissions.submitted=0` and, while the application is in no round yet, **deletes its round row**. The applicant's next submit re-applies on the same submission, which creates a new round row and so a new detail id.
- **Freeze.** `freeze_applications` only stops an application being moved, rejected or marked tentative out of the frozen round. The admin checks this before calling the backend, and the backend checks again (`APPLICATION_FROZEN`). It does **not** stop the applicant: a submitted application has no editable form anyway. Turning freeze on needs the Digital ID Card module (`startup_recognition_enabled`).
- **Admin views of an application.**
  - Table view: `submission-application-management-tableview/{id}/{slug}?perpage=100`. Each row shows a "Registered as …" badge when the applicant's **email** belongs to a member account; this is an email match, not `user_id`. A row shows the email only when it has no company name.
  - Detail page `/application-submission-detail/{id}` takes the application's **round row id** (from the table view), not the submission id. Answers are in `.dataRecord` → `.fieldType` / `.fieldValue`, and a file answer is a "View File (n)" button linking to the S3 object.
  - `CfaAdmin.submittedApplications` reads the table view.
  - **View as applicant (SAN-2002)** `[code: sc-saas-admin modules/application_management/view_as_applicant.php]`: both detail pages link to `application_management/view_as_applicant/{forms_submissions.id}`. It needs `backdoor_access` (or a partner session on its own program; else 403 and no backend call), has the backend mint a `sid` token (`src: admin`) and 302-redirects to `{frontend}/programs/apply/{code}/{slug}?isBackdoor=true&applicationEmail=…#applicantToken=…`. The token is only in the fragment; the PWA stores it and removes the fragment from the address bar. A save through that link may overwrite a submitted data-collection form (`isBackdoor`) only because the token is admin-issued.
- **Program lists for a member.** The member `/call-for-applications` list hides test-mode programs, like the public one. **My Applications** (`POST application-programs-management/applied/{email}`) does list them: `getAllPrograms(includeTestMode=false)` skips the test-mode filter (the parameter name is inverted).
- **Closed program (D9).** On a closed program the Apply button is disabled and its tooltip reads "We are no longer accepting new applications". The program is listed under **Past**, not Active (the default section). This was checked read-only against a real closed dev program. The `[QA] CFA Closed (do not delete)` program does **not** exist on dev yet: `QA_CFA_CLOSED_PROGRAM_PATH` points at no program, so the D9 tests skip.
- **Known product bugs.** Tests for these are marked `test.fail()`. Remove `test.fail()` when the fix ships and the test "unexpectedly passes".
  - **SAN-1878:** "Tentative" on a CFA application always fails. The backend has no `tentative-round` route.
  - **SAN-1886:** the CFA apply API accepts applications to closed, past-deadline or unpublished programs. Enforcement exists only in the PWA.
  - **SAN-1890:** whitespace-only required fields pass. `trim(($_POST['x']) == "")` trims the boolean; ~975 occurrences in sc-saas-admin. Known-failing: the whitespace round-title test.
  - **Not filed yet (P3):** a builder field whose visibility rule was never edited is hidden on the PWA apply form (see "A field's visibility rule" above). Known-failing test in `p3-apply-guest.spec.ts`.
  - Round names are **not** unique per program. That's a product decision, not a bug (FT-006 D11).
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
| SAN-1887 | admin | **form-management/versions.php has no login check: anonymous read and restore (overwrite) of any form** | Todo (Sandeep), Urgent |
| SAN-1888 | admin | Re-opening applications forces allow_re_application / auto_communication / editable_jury_ratings ON | Todo (Sandeep) |
| SAN-1889 | admin | Program-list search ignored on Live / Ongoing tabs; last search sticks in the session | Todo (Sandeep) |
| SAN-1890 | admin | `trim(($_POST['x']) == "")` never trims, so whitespace-only values pass (~975 lines) | Todo (Sandeep) |
| SAN-1891 | admin | After "import fields", the Current version card shows the pre-import fields | Todo (Sandeep) |
