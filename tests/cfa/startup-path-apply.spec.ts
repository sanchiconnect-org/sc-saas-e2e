/**
 * Startup regression path, journey 3 of 5 (SAN-1606): the seeded startup applies to a program.
 * Owner: Ritu Raj
 * Pass bar: the apply call returns 2xx and the PWA confirms the submission; after a reload the
 * page shows the application number from the status check; the backend reports the application
 * submitted and in no round yet; the admin table lists it as Submitted, registered as a startup.
 *
 * Runs on its own throwaway test-mode program (one account, one live application per program),
 * deleted at the end; cfa-teardown deletes it if the test crashes first.
 */
import { authFile } from '../../config/accounts';
import { deleteCfaProgram, expect, test } from '../../fixtures/cfa';
import { ApplicationStatusPage } from '../../pages/frontend/cfa/ApplicationStatusPage';
import { tableRow } from './p3-helpers';
import { applyAsStartup, createPathProgram, startup } from './startup-path-helpers';

test.describe('startup path: apply', { tag: ['@regression', '@cfa', '@frontend', '@startup', '@write'] }, () => {
  test.skip(!startup, 'QA_STARTUP_EMAIL not set');
  test.use({ storageState: authFile('startup') });

  test('the seeded startup applies and the application is submitted, numbered and listed for the admin', async ({ cfaAdmin, cfaRun, page }) => {
    test.setTimeout(180_000);
    const program = await createPathProgram(cfaAdmin, cfaRun.runId, 'apply');
    try {
      const { submissionId } = await applyAsStartup(page, program);

      const statusPage = new ApplicationStatusPage(page);
      const status = statusPage.waitForDetails(program.uuid);
      await page.reload();
      const details = await ApplicationStatusPage.details(await status);
      expect(details).toMatchObject({ submissionId: Number(submissionId), isRejected: false, currentRoundId: null });
      expect(details.applicationNumber, 'applicationNumber in the status check').toMatch(/^APP\d+$/);
      await expect(statusPage.applicationNumber(details.applicationNumber!)).toBeVisible();

      const row = await tableRow(cfaAdmin, program, (r) => r.submissionId === submissionId);
      expect(row.status).toBe('Submitted');
      expect(row.registeredAs, '"Registered as … (Startup)" badge').toMatch(/startup/i);
    } finally {
      await deleteCfaProgram(cfaAdmin, program.id);
    }
  });
});
