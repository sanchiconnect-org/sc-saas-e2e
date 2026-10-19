/**
 * Startup regression path, journey 4 of 5 (SAN-1606): the startup tracks its application.
 * Owner: Ritu Raj
 * Pass bar: after applying, My Applications (POST application-programs-management/applied/{email})
 * lists the program and the page shows it; the apply page's status view reports the application
 * number and no round; after the admin moves it into round 1, the status view reports round 1 and
 * "accepted" (and shows the round tab when application_management_round_status_updates is on).
 *
 * Runs on its own throwaway test-mode program, deleted at the end. Round 1 keeps the default
 * silent transfer, so the move sends no email (emails are journey 5). Moves by the same admin
 * must not run concurrently (SAN-1893): run with --workers=1.
 */
import { authFile } from '../../config/accounts';
import { deleteCfaProgram, expect, test } from '../../fixtures/cfa';
import { ApplicationStatusPage } from '../../pages/frontend/cfa/ApplicationStatusPage';
import { ProgramApplyPage } from '../../pages/frontend/cfa/ProgramApplyPage';
import { applyAsStartup, createPathProgram, startup } from './startup-path-helpers';

test.describe('startup path: track the application', { tag: ['@regression', '@cfa', '@frontend', '@startup', '@write'] }, () => {
  test.skip(!startup, 'QA_STARTUP_EMAIL not set');
  test.use({ storageState: authFile('startup') });

  test('My Applications lists the application and the status view follows it into round 1', async ({ cfaAdmin, cfaFlags, cfaRun, page }) => {
    test.setTimeout(180_000);
    const program = await createPathProgram(cfaAdmin, cfaRun.runId, 'track');
    try {
      const { submissionId } = await applyAsStartup(page, program);

      const applied = page.waitForResponse((r) => r.request().method() === 'POST' && /\/application-programs-management\/applied\//.test(r.url()));
      await page.goto('/call-for-applications/applied');
      const appliedResponse = await applied;
      expect(appliedResponse.ok(), `My Applications: HTTP ${appliedResponse.status()}`).toBe(true);
      const appliedPrograms: { program?: { uuid?: string } }[] = (await appliedResponse.json())?.data ?? [];
      expect(appliedPrograms.map((a) => a.program?.uuid)).toContain(program.uuid);
      await expect(page.getByText(program.title, { exact: true })).toBeVisible();

      const apply = new ProgramApplyPage(page);
      const status = new ApplicationStatusPage(page);
      let details = status.waitForDetails(program.uuid);
      await apply.goto(program.code, program.slug, { autoStatusCheck: true });
      const before = await ApplicationStatusPage.details(await details);
      expect(before).toMatchObject({ submissionId: Number(submissionId), isRejected: false, currentRoundId: null });
      expect(before.applicationNumber).toMatch(/^APP\d+$/);
      await expect(status.applicationNumber(before.applicationNumber!)).toBeVisible();

      const [r1] = program.roundIds;
      await cfaAdmin.moveToRound(program, [submissionId], r1);

      details = status.waitForDetails(program.uuid);
      await page.reload();
      const after = await ApplicationStatusPage.details(await details);
      expect(after).toMatchObject({
        applicationNumber: before.applicationNumber,
        applicationStatus: 'accepted',
        currentRoundId: Number(r1),
        isRejected: false,
      });
      if (cfaFlags.application_management_round_status_updates) {
        const r1Name = (await cfaAdmin.programRounds(program)).find((r) => r.id === r1)!.name;
        await expect(status.roundTab(r1Name)).toBeVisible();
      }
    } finally {
      await deleteCfaProgram(cfaAdmin, program.id);
    }
  });
});
