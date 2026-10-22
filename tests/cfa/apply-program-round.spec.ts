/**
 * Journey 4 (SAN-1576): a logged-in startup applies to a program round.
 * Owner: Ritu Raj
 * Pass bar: POST application-programs-management/{programUuid}/{submissionId}/apply returns 2xx,
 * and after a reload the application-status check returns an application number that the
 * page shows in "You are applying as … | Application# …".
 *
 * Uses its own throwaway test-mode program with one round (never listed anywhere public), so a
 * CI retry or a CFA test that applies as the same startup never finds an earlier application.
 * The program is deleted at the end; cfa-teardown deletes it if the test crashes first.
 * The fuller member checks (no OTP, account link, My Applications) are in p3-apply-member.spec.ts.
 */
import { authFile, memberAccount } from '../../config/accounts';
import { createCfaProgram, deleteCfaProgram, expect, test } from '../../fixtures/cfa';
import { ApplicationStatusPage } from '../../pages/frontend/cfa/ApplicationStatusPage';
import { ProgramApplyPage } from '../../pages/frontend/cfa/ProgramApplyPage';

test.describe('apply to a program round', { tag: ['@smoke', '@cfa', '@frontend', '@startup', '@write'] }, () => {
  test.skip(!memberAccount('startup'), 'QA_STARTUP_EMAIL not set');
  test.use({ storageState: authFile('startup') });

  test('a startup submits an application and gets an application number', async ({ cfaAdmin, cfaRun, page }) => {
    test.setTimeout(150_000);
    const program = await createCfaProgram(cfaAdmin, {
      runId: cfaRun.runId,
      label: `smoke-apply-${Math.random().toString(36).slice(2, 8)}`,
      rounds: 1,
      ratingCriteriaOnLastRound: false,
    });
    try {
      const apply = new ProgramApplyPage(page);
      await apply.goto(program.code, program.slug);
      await expect(apply.programTitle(program.title)).toBeVisible({ timeout: 20_000 });

      const modal = await apply.startApplication();
      const firstSave = apply.firstSave(program.formUUID);
      await modal.submitWithoutOtp();
      await apply.formReady(firstSave);

      const { applyStatus } = await apply.submitApplication(program);
      expect(applyStatus, 'apply').toBeLessThan(300);
      await expect(apply.submittedConfirmation).toBeVisible();

      const statusPage = new ApplicationStatusPage(page);
      const status = statusPage.waitForDetails(program.uuid);
      await page.reload();
      const details = await ApplicationStatusPage.details(await status);
      expect(details.applicationNumber, 'applicationNumber in the status check').toMatch(/^APP\d+$/);
      await expect(statusPage.applicationNumber(details.applicationNumber!)).toBeVisible();
    } finally {
      await deleteCfaProgram(cfaAdmin, program.id);
    }
  });
});
