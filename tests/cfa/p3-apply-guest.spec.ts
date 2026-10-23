/**
 * CFA regression suite P3 (FT-006 / SAN-1881): the guest applicant path on the PWA.
 * Owner: Ritu Raj
 * Pass bar: a guest applies (with the real fixed OTP once, otherwise on a bypass-OTP program),
 * drafts save and restore, the required-field rule holds, a file upload reaches the admin, the
 * applicant sees their round, a rejected guest re-applies on the SAME submission, and a
 * resubmission request round-trips. Every check reads state back from the backend response
 * the PWA itself got, the admin table/detail/drafts pages, or the admin email log, never a toast.
 *
 * Rate limits: OTP send/verify and the CFA apply route are limited to 10 requests per 60 s.
 * Only the first test sends an OTP. Applicants that only need to EXIST (status, re-apply,
 * resubmission, freeze) are CSV-seeded by the admin, not applied through the PWA.
 *
 * A guest flow creates no user: the guest's identity lives in localStorage['application-{uuid}'].
 *
 * SAN-1959: the guest also holds an applicant token (localStorage['applicant-token-{uuid}'], sent as
 * x-applicant-token): from the OTP verify on a normal program, or from the first form save on a
 * bypass-OTP program (a submission-scoped `sid` token). useGuestIdentity() stores one obtained through
 * the fixed OTP, so the seeded-applicant tests pass in APPLICANT_TOKEN_MODE=log and enforce alike.
 */
import * as path from 'path';
import { qaOtp } from '../../config/accounts';
import { env } from '../../config/env';
import {
  APPLICANT_TOKEN_HEADER,
  BUILDER_DEFAULT_VISIBILITY,
  cfaEmail,
  createCfaProgram,
  decodeApplicantToken,
  deleteCfaProgram,
  expect,
  test,
  type CfaProgram,
  type CfaRun,
} from '../../fixtures/cfa';
import { newestEmailLogRowId, waitForNewEmailLogRow } from '../../fixtures/email-log';
import { type Page, type Request } from '@playwright/test';
import { ApplicantOtpPrompt } from '../../pages/frontend/cfa/ApplicantOtpPrompt';
import { ApplicationStatusPage } from '../../pages/frontend/cfa/ApplicationStatusPage';
import { ProgramApplyPage, isApply, isFormSave, savePayload } from '../../pages/frontend/cfa/ProgramApplyPage';
import { FILE, NOTES, SHORT, createP3Program, rand, tableRow } from './p3-helpers';

const TAGS = ['@regression', '@cfa', '@write', '@frontend'];
const PDF = path.resolve(__dirname, '..', '..', 'fixtures', 'files', 'qa-pitch-deck.pdf');

function skipIfRunSkipped(run: CfaRun) {
  test.skip(!!run.skipReason, run.skipReason);
}

/** Records every apply call and final (submitted=true) save the page makes. */
function recordSubmits(page: Page, program: CfaProgram): Request[] {
  const seen: Request[] = [];
  page.on('request', (req) => {
    if (isApply(req, program.uuid) || (isFormSave(req, program.formUUID) && savePayload(req).submitted === true)) seen.push(req);
  });
  return seen;
}

/** The value the admin detail page shows for one form field. */
function detailValue(adminPage: Page, fieldName: string) {
  return adminPage.locator('.dataRecord').filter({ has: adminPage.locator('.fieldType', { hasText: fieldName }) }).locator('.fieldValue');
}

test.describe('CFA P3: guest applies with the real OTP', { tag: TAGS }, () => {
  test('lead modal + fixed OTP + submit: the submission is a guest one in the admin table view', async ({ adminPage, cfaAdmin, cfaFlags, cfaProgram, cfaRun, page }) => {
    test.skip(!env.cfa.emailPattern, 'QA_CFA_EMAIL_PATTERN not set: the backend has no fixed OTP for CFA guest addresses');
    test.setTimeout(120_000);
    const tag = rand();
    const applicant = { name: `QA p3otp ${tag}`, email: cfaEmail(cfaRun.runId, `p3otp_${tag}`) };

    const apply = new ProgramApplyPage(page);
    await apply.goto(cfaProgram.code, cfaProgram.slug);
    await expect(apply.programTitle(cfaProgram.title)).toBeVisible({ timeout: 20_000 });
    const modal = await apply.startApplication();
    expect((await modal.fillApplicant(applicant)).ok(), 'lead upsert').toBe(true);

    const sent = await modal.sendOtp();
    expect(sent.status(), 'otp_verifications/send').toBeLessThan(400);
    const firstSave = apply.firstSave(cfaProgram.formUUID);
    const verified = await modal.verifyOtp(qaOtp());
    const verifyBody = await verified.text();
    /* A 409 "Invalid one time password" for md5(QA_OTP) means the backend does not issue the fixed
       OTP for this address: QA_FIXED_OTP_EMAILS on the QA deployment lacks QA_CFA_EMAIL_PATTERN
       (FT-006 D4). That is an environment prerequisite, not a product failure. */
    test.skip(
      verified.status() === 409 && /Invalid one time password/i.test(verifyBody),
      'the QA backend does not issue the fixed OTP for QA_CFA_EMAIL_PATTERN addresses: add the pattern to its QA_FIXED_OTP_EMAILS (FT-006 D4)',
    );
    expect(verified.ok(), `otp_verifications/verify: HTTP ${verified.status()} ${verifyBody}`).toBe(true);
    await expect(modal.root).toBeHidden();
    /* The guest identity is only kept in the browser: no session, no user. */
    expect(await apply.storedIdentity(cfaProgram.uuid)).toMatchObject({ email: applicant.email, name: applicant.name });

    /* SAN-1959: the verify names the program and gets back an email-scoped applicant token (120 min),
       which the PWA keeps for this program. */
    expect(JSON.parse(verified.request().postData() ?? '{}').applicantProgramUUID, 'verify names the program').toBe(cfaProgram.uuid);
    const issued = JSON.parse(verifyBody)?.data ?? {};
    expect(typeof issued.applicantToken, 'verify returns applicantToken').toBe('string');
    const claims = decodeApplicantToken(issued.applicantToken);
    expect(claims).toMatchObject({ typ: 'cfa_applicant', email: applicant.email.toLowerCase(), programUUID: cfaProgram.uuid });
    expect(claims.sid, 'an OTP token is email-scoped, not tied to one submission').toBeUndefined();
    expect(claims.exp - claims.iat, 'token lifetime').toBe(120 * 60);
    expect(Date.parse(issued.applicantTokenExpiresAt)).toBe(claims.exp * 1000);
    expect((await apply.storedApplicantToken(cfaProgram.uuid))?.token, 'stored as applicant-token-<uuid>').toBe(issued.applicantToken);

    const first = await apply.formReady(firstSave);
    expect(savePayload(first).userId ?? null, 'a guest save carries no user id').toBeNull();
    expect((await first.request().allHeaders())[APPLICANT_TOKEN_HEADER], 'the form save sends the token').toBe(issued.applicantToken);

    /* Answer every text question of the template form the PWA shows (a field whose visibility
       rule is unset, field=null + condition "is", is hidden by the PWA). */
    for (const f of (await cfaAdmin.formFields(cfaProgram.formId)).filter((x) => x.type === 'text_field' || x.type === 'text_area')) {
      if (await apply.field(f.key).isVisible()) await apply.field(f.key).fill(`QA answer ${tag}`);
    }
    const applyRequest = page.waitForRequest((r) => isApply(r, cfaProgram.uuid));
    const { save, applyStatus } = await apply.submitApplication(cfaProgram);
    expect((await save.json())?.data?.submitted, 'saved as submitted').toBeTruthy();
    expect(applyStatus, 'apply').toBeLessThan(300);
    await expect(apply.submittedConfirmation).toBeVisible();
    expect((await save.request().allHeaders())[APPLICANT_TOKEN_HEADER], 'the final save sends the token').toBe(issued.applicantToken);
    expect((await (await applyRequest).allHeaders())[APPLICANT_TOKEN_HEADER], 'the apply call sends the token').toBe(issued.applicantToken);

    const row = await tableRow(cfaAdmin, cfaProgram, (r) => r.email === applicant.email);
    expect(row.status).toBe('Submitted');
    expect(row.registeredAs, 'a guest applicant has no member account').toBeNull();

    /* The OTP itself was mailed (template verify-email-address). */
    expect(await newestEmailLogRowId(adminPage, applicant.email, 'verify-email-address'), 'verify-email-address logged').not.toBeNull();
    if (cfaFlags.call_for_applications_submitted_email_enabled) {
      await waitForNewEmailLogRow(adminPage, applicant.email, 'application-program-management-application', null);
    } else {
      test.info().annotations.push({ type: 'skipped-check', description: 'call_for_applications_submitted_email_enabled is off: no submitted email expected' });
    }
  });
});

test.describe('CFA P3: guest applicants on a bypass-OTP program', { tag: TAGS }, () => {
  test.describe.configure({ mode: 'serial' });
  let program: CfaProgram;

  test.beforeAll(async ({ cfaAdmin, cfaRun }) => {
    test.setTimeout(120_000);
    skipIfRunSkipped(cfaRun);
    program = await createP3Program(cfaAdmin, cfaRun.runId, 'p3-guest');
  });

  test.afterAll(async ({ cfaAdmin }) => {
    if (program) await deleteCfaProgram(cfaAdmin, program.id);
  });

  /**
   * Opens the program as a new guest and goes through the (OTP-less) modal to the form.
   * SAN-1959 (decision 1, lazy OTP): the guest has no token yet; the first save creates the row
   * without one and its response carries a submission-scoped token (sid = that row, src = created),
   * which the PWA stores and sends from then on.
   */
  async function openFormAsNewGuest(page: Page, applicant: { name: string; email: string }) {
    const apply = new ProgramApplyPage(page);
    await apply.goto(program.code, program.slug);
    const modal = await apply.startApplication();
    expect((await modal.fillApplicant(applicant)).ok(), 'lead upsert').toBe(true);
    const firstSave = apply.firstSave(program.formUUID);
    await modal.submitWithoutOtp();
    const first = await apply.formReady(firstSave);
    await expectCreatedSidToken(apply, first, applicant.email);
    return { apply, first };
  }

  /** The bypass first save's sid token: issued for the new row only, and kept by the PWA. */
  async function expectCreatedSidToken(apply: ProgramApplyPage, first: Awaited<ReturnType<ProgramApplyPage['formReady']>>, email: string) {
    expect((await first.request().allHeaders())[APPLICANT_TOKEN_HEADER], 'the first save goes without a token').toBeUndefined();
    const data = (await first.json())?.data ?? {};
    expect(typeof data.applicantToken, 'the first save returns a sid token').toBe('string');
    expect(decodeApplicantToken(data.applicantToken)).toMatchObject({
      typ: 'cfa_applicant',
      email: email.toLowerCase(),
      programUUID: program.uuid,
      sid: Number(data.id),
      src: 'created',
    });
    await expect.poll(async () => (await apply.storedApplicantToken(program.uuid))?.token, { message: 'stored as applicant-token-<uuid>' }).toBe(data.applicantToken);
  }

  test('with bypass_otp_verification the guest applies without an OTP', async ({ adminPage, cfaAdmin, cfaRun, page }) => {
    const tag = rand();
    const applicant = { name: `QA p3bypass ${tag}`, email: cfaEmail(cfaRun.runId, `p3bypass_${tag}`) };
    const otpCalls: string[] = [];
    page.on('request', (r) => r.url().includes('otp_verifications/') && otpCalls.push(r.url()));

    const { apply } = await openFormAsNewGuest(page, applicant);
    await apply.field(SHORT.key).fill(`QA bypass ${tag}`);
    const { applyStatus } = await apply.submitApplication(program);
    expect(applyStatus, 'apply').toBeLessThan(300);
    await expect(apply.submittedConfirmation).toBeVisible();

    expect(otpCalls, 'no OTP request on a bypass program').toEqual([]);
    const row = await tableRow(cfaAdmin, program, (r) => r.email === applicant.email);
    expect(row).toMatchObject({ status: 'Submitted', registeredAs: null });
    expect(await newestEmailLogRowId(adminPage, applicant.email, 'verify-email-address'), 'no verify-email-address row').toBeNull();
  });

  test('an empty required field blocks the submit: message shown, no submit or apply call', async ({ cfaRun, page }) => {
    const tag = rand();
    const { apply } = await openFormAsNewGuest(page, { name: `QA p3req ${tag}`, email: cfaEmail(cfaRun.runId, `p3req_${tag}`) });
    const submits = recordSubmits(page, program);

    await apply.field(NOTES.key).fill(`QA notes only ${tag}`);
    await expect(apply.submitApplicationButton).toBeDisabled();
    await apply.incompleteFieldsBadge.click();
    await expect(apply.requiredMessage(SHORT.key)).toBeVisible();
    await apply.submitApplicationButton.click({ force: true }).catch(() => undefined);
    /* Give a stray submit time to show up before asserting there was none. */
    await page.waitForTimeout(2_000);
    expect(submits.map((r) => r.url()), 'no final save and no apply').toEqual([]);
    await expect(apply.submittedConfirmation).toHaveCount(0);
  });

  test('Save as Draft lists a draft (submitted=0) and the same browser gets its answers back', async ({ cfaAdmin, cfaRun, page }) => {
    const tag = rand();
    const applicant = { name: `QA p3draft${tag}`, email: cfaEmail(cfaRun.runId, `p3draft_${tag}`) };
    const { apply } = await openFormAsNewGuest(page, applicant);

    const shortValue = `QA draft short ${tag}`;
    const notesValue = `QA draft notes ${tag}`;
    await apply.field(SHORT.key).fill(shortValue);
    await apply.field(NOTES.key).fill(notesValue);
    const saved = await apply.saveDraft(program.formUUID);
    expect(saved.ok(), `draft save: HTTP ${saved.status()}`).toBe(true);
    expect(savePayload(saved).data).toMatchObject({ [SHORT.key]: shortValue, [NOTES.key]: notesValue });
    const draft = (await saved.json())?.data;
    expect(draft?.submitted, 'stored as a draft').toBeFalsy();

    const drafts = await cfaAdmin.findDrafts(program, `p3draft${tag}`);
    expect(drafts.map((d) => d.email), 'admin drafts page').toEqual([applicant.email]);
    expect(drafts[0].id).toBe(String(draft.id));
    expect((await cfaAdmin.submittedApplications(program)).map((r) => r.submissionId), 'not in the submitted table').not.toContain(String(draft.id));

    /* Same context, same localStorage identity: the form comes back with the saved answers. */
    await page.reload();
    await expect(apply.field(SHORT.key)).toHaveValue(shortValue, { timeout: 30_000 });
    await expect(apply.field(NOTES.key)).toHaveValue(notesValue);
  });

  test('autosave stores typed answers without any click', async ({ cfaAdmin, cfaRun, page }) => {
    /* The one test that waits out the autosave timer: the form's autoSaveTimer (60 s on the dev
       QA tenant's forms; the PWA falls back to 20 s when it is unset). */
    test.setTimeout(150_000);
    const tag = rand();
    const applicant = { name: `QA p3auto${tag}`, email: cfaEmail(cfaRun.runId, `p3auto_${tag}`) };
    const { apply } = await openFormAsNewGuest(page, applicant);

    const value = `QA autosaved ${tag}`;
    const autosave = page.waitForResponse(
      (r) => isFormSave(r, program.formUUID) && savePayload(r).submitted === false && savePayload(r).data?.[NOTES.key] === value,
      { timeout: 90_000 },
    );
    await apply.field(NOTES.key).fill(value);
    const saved = await autosave;
    expect(saved.ok(), `autosave: HTTP ${saved.status()}`).toBe(true);

    expect((await cfaAdmin.findDrafts(program, `p3auto${tag}`)).map((d) => d.email)).toEqual([applicant.email]);
    await page.reload();
    await expect(apply.field(NOTES.key)).toHaveValue(value, { timeout: 30_000 });
  });

  test('a PDF attached to the file-upload field is listed on the admin detail page', async ({ adminPage, cfaAdmin, cfaRun, page }) => {
    const tag = rand();
    const applicant = { name: `QA p3file ${tag}`, email: cfaEmail(cfaRun.runId, `p3file_${tag}`) };
    const { apply } = await openFormAsNewGuest(page, applicant);

    await apply.field(SHORT.key).fill(`QA with file ${tag}`);
    const [upload] = await Promise.all([
      page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes(`/submission/${program.formUUID}/upload-file`)),
      apply.fileInput(FILE.name).setInputFiles(PDF),
    ]);
    expect(upload.ok(), `upload-file: HTTP ${upload.status()} ${upload.url()}`).toBe(true);
    const fileUrl: string = (await upload.json())?.data;
    expect(fileUrl, 'uploaded file url').toMatch(/\.pdf$/i);
    await expect(apply.uploadedFiles(FILE.name)).toBeVisible();

    const { save, applyStatus } = await apply.submitApplication(program);
    expect(applyStatus, 'apply').toBeLessThan(300);
    expect(JSON.stringify(savePayload(save).data?.[FILE.key] ?? null), 'file in the submitted answers').toContain(fileUrl);

    const row = await tableRow(cfaAdmin, program, (r) => r.email === applicant.email);
    await adminPage.goto(`/application-submission-detail/${row.detailId}`);
    const shown = detailValue(adminPage, FILE.name);
    await expect(shown).toBeVisible();
    const fileName = fileUrl.split('/').pop()!;
    /* The detail page lists each file as a "View File (n)" button linking to the S3 object. */
    const viewFile = shown.locator(`.openFileViewer[href*="${fileName}"]`);
    await expect(viewFile).toHaveCount(1);
    await expect(viewFile).toHaveText(/View File \(1\)/);
  });

  test('the status view shows the current round, and the new one after an admin move', async ({ cfaAdmin, cfaFlags, page }) => {
    const [seeded] = await cfaAdmin.seedSubmittedApplications(program, 1, 'p3status');
    const rounds = await cfaAdmin.programRounds(program);
    const [r1, r2] = program.roundIds.map((id) => rounds.find((r) => r.id === id)!);
    await cfaAdmin.moveToRound(program, [seeded.id], r1.id);

    const apply = new ProgramApplyPage(page);
    const status = new ApplicationStatusPage(page);
    await apply.useGuestIdentity(program.uuid, { email: seeded.email, name: seeded.name });
    let details = status.waitForDetails(program.uuid);
    await apply.goto(program.code, program.slug, { autoStatusCheck: true });
    expect(await ApplicationStatusPage.details(await details)).toMatchObject({ submissionId: Number(seeded.id), currentRoundId: Number(r1.id) });
    await expect(status.statusTab).toBeVisible();

    const roundStatusShown = !!cfaFlags.application_management_round_status_updates;
    if (roundStatusShown) await expect(status.roundTab(r1.name)).toBeVisible();

    await cfaAdmin.moveToRound(program, [seeded.id], r2.id);
    details = status.waitForDetails(program.uuid);
    await page.reload();
    expect(await ApplicationStatusPage.details(await details)).toMatchObject({ currentRoundId: Number(r2.id) });
    if (roundStatusShown) {
      await expect(status.roundTab(r2.name)).toBeVisible();
    } else {
      test.info().annotations.push({ type: 'skipped-check', description: 'application_management_round_status_updates is off: round tabs are not rendered, checked the status data only' });
    }
  });

  test('a rejected guest re-applies on the same submission (SAN-352): no new row', async ({ cfaAdmin, page }) => {
    const [seeded] = await cfaAdmin.seedSubmittedApplications(program, 1, 'p3reapply');
    await cfaAdmin.rejectApplications(program, [seeded.id]);
    const before = await tableRow(cfaAdmin, program, (r) => r.submissionId === seeded.id);
    expect(before.status).toBe('Rejected');

    const apply = new ProgramApplyPage(page);
    const status = new ApplicationStatusPage(page);
    await apply.useGuestIdentity(program.uuid, { email: seeded.email, name: seeded.name });
    const details = status.waitForDetails(program.uuid);
    await apply.goto(program.code, program.slug);
    expect(await ApplicationStatusPage.details(await details)).toMatchObject({ isRejected: true, allowReapplication: true, canReapplyNow: true });
    await expect(apply.rejectedNotice).toBeVisible();

    await apply.reapplyNowButton.click();
    const value = `QA reapplied ${rand()}`;
    await expect(apply.field(SHORT.key)).toBeVisible({ timeout: 30_000 });
    await apply.field(SHORT.key).fill(value);
    const { save, applyStatus, submissionId } = await apply.submitApplication(program);
    expect(applyStatus, 'apply').toBeLessThan(300);
    expect(savePayload(save).submissionId, 'the save targets the rejected submission').toBe(Number(seeded.id));
    expect(String((await save.json())?.data?.id), 'the backend edited that same row').toBe(seeded.id);
    expect(submissionId, 'apply on the same submission').toBe(seeded.id);

    const rows = (await cfaAdmin.submittedApplications(program)).filter((r) => r.title === before.title);
    expect(rows.map((r) => r.submissionId), 'still exactly one row for this applicant').toEqual([seeded.id]);
    expect(rows[0].status).toBe('Submitted');
  });

  test('sent back for resubmission, the applicant resubmits and the admin sees the new answer', async ({ adminPage, browser, cfaAdmin }) => {
    test.setTimeout(120_000);
    const [seeded] = await cfaAdmin.seedSubmittedApplications(program, 1, 'p3resub');
    const row = await tableRow(cfaAdmin, program, (r) => r.submissionId === seeded.id);

    const mailBefore = await newestEmailLogRowId(adminPage, seeded.email, 'resubmit-application');
    expect(
      await cfaAdmin.sendForResubmission(program, { detailId: row.detailId, submissionId: seeded.id, name: seeded.name, email: seeded.email }, '[QA] please update your answer'),
    ).toMatchObject({ error: false, success: true });
    await waitForNewEmailLogRow(adminPage, seeded.email, 'resubmit-application', mailBefore);

    /* The applicant follows the mailed link in a fresh browser: Apply → modal → their open application. */
    const context = await browser.newContext({ baseURL: env.frontendUrl });
    try {
      const page = await context.newPage();
      const apply = new ProgramApplyPage(page);
      await apply.goto(program.code, program.slug);
      const modal = await apply.startApplication();
      await modal.fillApplicant({ name: seeded.name, email: seeded.email });
      const firstSave = apply.firstSave(program.formUUID);
      await modal.submitWithoutOtp();
      /* SAN-1959 lazy OTP: this guest has a row already, so the tokenless first save may only create.
         In APPLICANT_TOKEN_MODE=enforce it is refused (401 APPLICANT_TOKEN_REQUIRED) and the page asks for
         the email OTP once, then loads the saved application. In log mode the save goes through as before. */
      const first = await firstSave;
      if (first.status() === 401) {
        expect((await first.json())?.code).toBe('APPLICANT_TOKEN_REQUIRED');
        test.info().annotations.push({ type: 'applicant-token', description: 'enforce: the returning bypass guest proved the email by OTP' });
        await new ApplicantOtpPrompt(page).verify(qaOtp());
        expect(await apply.storedApplicantToken(program.uuid), 'the OTP token is kept').not.toBeNull();
      } else {
        expect(first.ok(), `first save: HTTP ${first.status()}`).toBe(true);
        expect((await first.json())?.data?.applicantToken, 'no token for a save that updates an existing row').toBeUndefined();
      }
      await expect(apply.field(SHORT.key)).toBeVisible({ timeout: 30_000 });

      const value = `QA resubmitted ${rand()}`;
      await apply.field(SHORT.key).fill(value);
      const { save, applyStatus, submissionId } = await apply.submitApplication(program);
      expect(applyStatus, 'apply').toBeLessThan(300);
      expect(submissionId, 'same submission').toBe(seeded.id);
      expect(String((await save.json())?.data?.id)).toBe(seeded.id);

      const after = await tableRow(cfaAdmin, program, (r) => r.submissionId === seeded.id);
      expect(after.status).toBe('Submitted');
      await adminPage.goto(`/application-submission-detail/${after.detailId}`);
      await expect(detailValue(adminPage, SHORT.name)).toContainText(value);
    } finally {
      await context.close();
    }
  });

  test("freeze: a frozen round's application can't be moved out, and the applicant still sees that round", async ({ cfaAdmin, page }) => {
    /* FT-006 P3 asks for "freeze blocks the applicant's save/resubmit". The product does not
       do that: freeze_applications only stops an application being moved, rejected or marked
       tentative out of the frozen round (backend ApiErrors.APPLICATION_FROZEN at
       application-program.service.ts:771,1049 guards update-round and reject-round, and the
       admin checks the same before calling them). A submitted application has no editable
       form on the PWA anyway. So this checks the freeze the product has, from both sides. */
    const [seeded] = await cfaAdmin.seedSubmittedApplications(program, 1, 'p3freeze');
    const [r1Id, r2Id] = program.roundIds;
    await cfaAdmin.moveToRound(program, [seeded.id], r2Id);

    try {
      await cfaAdmin.setRoundFreeze(program, r2Id, true);
    } catch (e) {
      test.skip(/Digital ID Card/.test((e as Error).message), 'freeze_applications needs the Digital ID Card module (startup_recognition_enabled) on this tenant');
      throw e;
    }
    try {
      await expect(cfaAdmin.moveToRound(program, [seeded.id], r1Id)).rejects.toThrow(/frozen/i);
      await expect(cfaAdmin.rejectApplications(program, [seeded.id])).rejects.toThrow(/frozen|cannot be moved/i);

      const apply = new ProgramApplyPage(page);
      const status = new ApplicationStatusPage(page);
      await apply.useGuestIdentity(program.uuid, { email: seeded.email, name: seeded.name });
      const details = status.waitForDetails(program.uuid);
      await apply.goto(program.code, program.slug);
      expect(await ApplicationStatusPage.details(await details)).toMatchObject({ currentRoundId: Number(r2Id), isRejected: false });
    } finally {
      await cfaAdmin.setRoundFreeze(program, r2Id, false);
    }
    expect(await cfaAdmin.moveToRound(program, [seeded.id], r1Id), 'unfrozen, the move goes through').toMatchObject({ success: true });
  });
});

test.describe('CFA P3: a builder-default field on the apply form', { tag: TAGS }, () => {
  test('a field whose properties were never edited in the builder is shown to the applicant', async ({ cfaAdmin, cfaRun, page }) => {
    /* Regression guard for SAN-1896 (fixed). A field dropped into the builder gets the default
       visibility rule {show:"show", field:null, condition:"is", value:null}; the PWA's
       isFieldVisibleCommon used to evaluate form[null] === null as false and hide the field. */
    test.setTimeout(120_000);
    const program = await createCfaProgram(cfaAdmin, { runId: cfaRun.runId, label: `p3-default-vis-${rand()}`, rounds: 0, ratingCriteriaOnLastRound: false });
    try {
      const plain = { key: 'field_qaP3Plain', name: 'QA plain field' };
      const untouched = { key: 'field_qaP3Untouched', name: 'QA untouched field' };
      await cfaAdmin.saveFormFields(program.formId, [
        {
          key: 'section_qaP3Vis',
          name: 'QA visibility',
          fields: [
            { ...plain, type: 'text_field' },
            { ...untouched, type: 'text_field', visiblity: BUILDER_DEFAULT_VISIBILITY },
          ],
        },
      ]);

      const apply = new ProgramApplyPage(page);
      await apply.useGuestIdentity(program.uuid, { email: cfaEmail(cfaRun.runId, `p3vis_${rand()}`), name: 'QA p3vis' });
      await apply.goto(program.code, program.slug);
      /* The control field renders, so the form itself loaded. */
      await expect(apply.field(plain.key)).toBeVisible({ timeout: 30_000 });
      await expect(apply.field(untouched.key)).toBeVisible();
    } finally {
      await deleteCfaProgram(cfaAdmin, program.id);
    }
  });
});
