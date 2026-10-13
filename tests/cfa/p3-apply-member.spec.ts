/**
 * CFA regression suite P3 (FT-006 / SAN-1881): the logged-in applicant (seeded startup) on the
 * PWA, and the closed-program check (D9).
 * Owner: Ritu Raj
 * Pass bar: the seeded startup applies with no OTP step and the submission is tied to its
 * account (admin "Registered as" badge, the user id on the PWA's own save, My Applications);
 * the run's test-mode program never shows in its program list; the long-lived closed program
 * shows applications closed with Apply disabled, under "Past", to a guest and to the startup.
 *
 * The startup uses its saved session (asRole), never a UI login (single-session rule). One
 * account holds one live application per program, so the apply test uses its own throwaway
 * program, deleted afterwards together with the application.
 */
import { memberAccount } from '../../config/accounts';
import { env } from '../../config/env';
import { asRole } from '../../fixtures/auth';
import { deleteCfaProgram, expect, test, type CfaAdmin, type CfaProgram } from '../../fixtures/cfa';
import { type Page } from '@playwright/test';
import { CallForApplicationsPage } from '../../pages/frontend/cfa/CallForApplicationsPage';
import { ProgramApplyPage, savePayload } from '../../pages/frontend/cfa/ProgramApplyPage';
import { SHORT, createP3Program, rand, tableRow } from './p3-helpers';

const startup = memberAccount('startup');

test.describe('CFA P3: the seeded startup applies', { tag: ['@regression', '@cfa', '@write', '@frontend', '@startup'] }, () => {
  test.skip(!startup, 'QA_STARTUP_EMAIL not set');
  asRole('startup');

  test('the per-run test-mode program is not in its /call-for-applications list', async ({ cfaProgram, page }) => {
    const list = new CallForApplicationsPage(page);
    const response = await list.goto();
    expect(response.ok()).toBe(true);
    /* Logged in, the list comes from the member route, not public/application-programs-management. */
    expect(response.url(), 'member (not public) program list').not.toContain('/public/');
    const programs: { uuid?: string; programCode?: string }[] = (await response.json())?.data ?? [];
    expect(programs.map((p) => p.uuid)).not.toContain(cfaProgram.uuid);
    expect(programs.map((p) => p.programCode)).not.toContain(cfaProgram.code);
    await expect(list.programCard(cfaProgram.title)).toHaveCount(0);
  });

  test.describe('on a throwaway program', () => {
    let program: CfaProgram;

    test.beforeAll(async ({ cfaAdmin, cfaRun }) => {
      test.setTimeout(120_000);
      test.skip(!!cfaRun.skipReason, cfaRun.skipReason);
      /* OTP required on the program: a member must still not get the OTP step. */
      program = await createP3Program(cfaAdmin, cfaRun.runId, 'p3-member', { bypassOtp: false });
    });

    test.afterAll(async ({ cfaAdmin }) => {
      if (program) await deleteCfaProgram(cfaAdmin, program.id);
    });

    test('no OTP step; the submission is linked to the startup account', async ({ cfaAdmin, page }) => {
      test.setTimeout(120_000);
      const otpCalls: string[] = [];
      page.on('request', (r) => r.url().includes('otp_verifications/') && otpCalls.push(r.url()));

      const apply = new ProgramApplyPage(page);
      await apply.goto(program.code, program.slug);
      await expect(apply.programTitle(program.title)).toBeVisible({ timeout: 20_000 });
      test.skip(
        !(await apply.applyButton.isEnabled()),
        'Apply is disabled for the seeded startup (approved_startups_can_apply_on_programs is on and its profile is not approved)',
      );

      const modal = await apply.startApplication();
      /* The modal is pre-filled from the member's profile and has no OTP step. */
      await expect(modal.emailInput).toHaveValue(new RegExp(`^${startup!.email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'));
      await expect(modal.actionButton).toHaveText(/submit/i);
      const firstSave = apply.firstSave(program.formUUID);
      await modal.submitWithoutOtp();
      const first = await apply.formReady(firstSave);
      const userId = savePayload(first).userId;
      expect(userId, 'the save carries the member user id').toBeTruthy();

      const answer = `QA member ${rand()}`;
      await apply.field(SHORT.key).fill(answer);
      const { save, applyStatus } = await apply.submitApplication(program);
      expect(applyStatus, 'apply').toBeLessThan(300);
      expect(savePayload(save).userId).toBe(userId);
      expect((await save.json())?.data?.userId, 'stored with the member user id').toBe(userId);
      await expect(apply.submittedConfirmation).toBeVisible();
      expect(otpCalls, 'no OTP request for a logged-in member').toEqual([]);

      /* Admin: the application row carries the "Registered as <name> (Startup)" badge. */
      const row = await tableRow(cfaAdmin, program, (r) => r.registeredAs !== null && r.status === 'Submitted');
      expect(row.registeredAs).toMatch(/startup/i);
      const detail = await cfaAdmin.html(`/application-submission-detail/${row.detailId}`);
      expect(detail.toLowerCase(), 'detail page shows the startup email').toContain(startup!.email.toLowerCase());
      expect(detail, 'detail page shows the answer').toContain(answer);

      /* My Applications lists it (applied/{email} includes test-mode programs). */
      const applied = page.waitForResponse((r) => r.request().method() === 'POST' && /\/application-programs-management\/applied\//.test(r.url()));
      await page.goto('/call-for-applications/applied');
      const appliedResponse = await applied;
      expect(appliedResponse.ok()).toBe(true);
      const appliedPrograms: { program?: { uuid?: string } }[] = (await appliedResponse.json())?.data ?? [];
      expect(appliedPrograms.map((a) => a.program?.uuid)).toContain(program.uuid);
      await expect(page.getByText(program.title, { exact: true })).toBeVisible();
    });
  });
});

/* ---------- D9: the long-lived closed program (read-only) ---------- */

const closedPath = env.cfa.closedProgramPath;

/** Code, slug and title of the closed program, with a sanity check that it really is closed. */
async function closedProgram(admin: CfaAdmin) {
  const [code, slug] = closedPath!.split('/');
  const backend = await admin.programByCode(code);
  test.skip(
    backend.status === 404,
    'QA_CFA_CLOSED_PROGRAM_PATH points at no program on this tenant: create "[QA] CFA Closed (do not delete)" and store its {code}/{slug} (FT-006 D9)',
  );
  expect(backend.status, `closed program ${code} on the backend`).toBe(200);
  const data = backend.data!;
  expect(data.testModeEnabled, 'the closed program must have test mode OFF (D9)').toBe(false);
  expect(data.applicationsClosed, 'the closed program must have applications closed (D9)').toBe(true);
  return { code, slug, title: String(data.programTitle), uuid: String(data.uuid) };
}

async function expectClosedApplyPage(page: Page, program: { code: string; slug: string; title: string }) {
  const apply = new ProgramApplyPage(page);
  await apply.goto(program.code, program.slug);
  await expect(apply.programTitle(program.title)).toBeVisible({ timeout: 20_000 });
  await expect(apply.applyButton).toBeDisabled();
  await apply.applyButton.locator('xpath=..').hover();
  await expect(apply.closedTooltip).toBeVisible();
}

async function expectListedUnderPast(page: Page, program: { uuid: string; title: string }) {
  const list = new CallForApplicationsPage(page);
  const response = await list.goto();
  expect(response.ok()).toBe(true);
  const programs: { uuid?: string }[] = (await response.json())?.data ?? [];
  expect(programs.map((p) => p.uuid), 'the closed program is listed (test mode off)').toContain(program.uuid);
  /* Active is the default section. */
  await expect(list.sectionButton('Active')).toHaveClass(/btn-dark/);
  await expect(list.programCard(program.title)).toHaveCount(0);
  await list.sectionButton('Past').click();
  await expect(list.programCard(program.title)).toHaveCount(1);
}

test.describe('CFA P3: the closed program blocks applying (D9)', { tag: ['@regression', '@cfa', '@frontend'] }, () => {
  test.skip(!closedPath, 'QA_CFA_CLOSED_PROGRAM_PATH not set');

  test('a guest sees applications closed, Apply disabled, and the program under Past', async ({ cfaAdmin, page }) => {
    const program = await closedProgram(cfaAdmin);
    await expectClosedApplyPage(page, program);
    await expectListedUnderPast(page, program);
  });

  test.describe('logged in', () => {
    test.skip(!startup, 'QA_STARTUP_EMAIL not set');
    asRole('startup');

    test('the seeded startup sees applications closed, Apply disabled, and the program under Past', { tag: '@startup' }, async ({ cfaAdmin, page }) => {
      const program = await closedProgram(cfaAdmin);
      await expectClosedApplyPage(page, program);
      await expectListedUnderPast(page, program);
    });
  });
});
