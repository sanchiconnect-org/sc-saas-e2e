/**
 * Journey 5 (SAN-1576): an admin reviews a submitted application and approves it into the first round.
 * Owner: Ritu Raj
 * Pass bar: the application's detail panel opens with its number, company and email; Move to
 * Round → R1 sends moveApplicationToNextRound with HTTP 200; the backend then reports the
 * application as accepted in R1, and the table row shows Accepted and the round name.
 *
 * Uses its own throwaway test-mode program with one round and one CSV-seeded submitted
 * application, deleted at the end (cfa-teardown deletes it if the test crashes first).
 * New rounds are silent transfers, so the approval sends no email to the applicant.
 *
 * Concurrent moves by the same admin fail with "Admin not found. Please try again." (SAN-1893),
 * so running this with --repeat-each needs --workers=1.
 */
import { createCfaProgram, deleteCfaProgram, expect, test } from '../../fixtures/cfa';
import { SubmissionsTablePage } from '../../pages/admin/cfa/SubmissionsTablePage';

test.describe('admin approves an application', { tag: ['@smoke', '@cfa', '@admin', '@write'] }, () => {
  test('a submitted application is reviewed and moved into the first round', async ({ adminPage, cfaAdmin, cfaRun }) => {
    test.setTimeout(120_000);
    const program = await createCfaProgram(cfaAdmin, {
      runId: cfaRun.runId,
      label: `smoke-approve-${Math.random().toString(36).slice(2, 8)}`,
      rounds: 1,
      ratingCriteriaOnLastRound: false,
    });
    try {
      const [application] = await cfaAdmin.seedSubmittedApplications(program, 1, 'smokeapprove');
      const [roundId] = program.roundIds;
      const before = await cfaAdmin.applicationStatus(program.uuid, application.email);
      expect(before.data?.currentRoundId ?? null, 'seeded application starts outside any round').toBeNull();

      const table = new SubmissionsTablePage(adminPage);
      await table.goto(program);
      await expect(table.row(application.id)).toContainText('Submitted');
      const applicationNumber = await table.applicationNumber(application.id);
      expect(applicationNumber).toMatch(/^APP\d+$/);

      await table.openDetail(application.id);
      await expect(table.detailTitle).toContainText(`#${applicationNumber}`);
      await expect(table.detailFrame.getByText(application.email)).toBeVisible({ timeout: 20_000 });
      await table.closeDetail();

      const moved = await table.moveToRound(application.id, roundId);
      expect(moved.response.ok(), `moveApplicationToNextRound returned ${moved.response.status()}`).toBe(true);
      expect(moved.json?.errorMessage ?? null, 'moveApplicationToNextRound errorMessage').toBeNull();

      const after = await cfaAdmin.applicationStatus(program.uuid, application.email);
      expect(after.data).toMatchObject({ applicationNumber, applicationStatus: 'accepted', currentRoundId: Number(roundId), isRejected: false });
      const row = table.row(application.id);
      await expect(row).toContainText('Accepted');
      await expect(row).toContainText(`[QA] R1-${cfaRun.runId}`);
    } finally {
      await deleteCfaProgram(cfaAdmin, program.id);
    }
  });
});
