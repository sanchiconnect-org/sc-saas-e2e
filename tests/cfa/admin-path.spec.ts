/**
 * Admin / program-office regression path (SAN-1607): create a program and round, review
 * applications, allot jury, approve (move to round) and reject.
 * Owner: Ritu Raj
 *
 * Pass bar: one throwaway test-mode program ends with (1) an extra round created after setup,
 * (2) two seeded submissions visible in the admin table, (3) one application moved into R1 as
 * accepted and allotted to the QA jury, (4) the other rejected — all read back from the admin
 * table / allotment modal / application-status API.
 *
 * The program-office PWA half of SAN-1607 is `tests/frontend/program-office-path.spec.ts`
 * (PO has no admin CFA controls). Concurrent admin moves need --workers=1 (SAN-1893).
 */
import { adminAccount } from '../../config/accounts';
import {
  createCfaProgram,
  deleteCfaProgram,
  expect,
  test,
  type CfaProgram,
} from '../../fixtures/cfa';
import { SubmissionsTablePage } from '../../pages/admin/cfa/SubmissionsTablePage';

const TAGS = ['@regression', '@cfa', '@admin', '@write'] as const;

test.describe('admin path: program → review → jury → approve/reject', { tag: [...TAGS] }, () => {
  test.skip(!adminAccount('admin'), 'QA_ADMIN_EMAIL / QA_ADMIN_PASSWORD not set');
  test.skip(!adminAccount('jury'), 'QA_JURY_EMAIL / QA_JURY_PASSWORD not set');

  test('create program and round, allot jury, approve one application and reject another', async ({
    adminPage,
    cfaAdmin,
    cfaRun,
  }) => {
    test.setTimeout(180_000);
    test.skip(!!cfaRun.skipReason, cfaRun.skipReason ?? '');

    let program: CfaProgram | undefined;
    try {
      program = await createCfaProgram(cfaAdmin, {
        runId: cfaRun.runId,
        label: `san1607-${Math.random().toString(36).slice(2, 8)}`,
        rounds: 1,
        ratingCriteriaOnLastRound: false,
      });
      const [r1] = program.roundIds;

      /* Explicit second round — ticket asks for "create a program and round". */
      const r2 = await cfaAdmin.createRound(program, `[QA] R2-${cfaRun.runId}-san1607`);
      expect(r2, 'createProgramRound returned a round id').toBeTruthy();
      const rounds = await cfaAdmin.programRounds(program);
      expect(rounds.map((r) => r.id)).toEqual(expect.arrayContaining([r1, r2]));

      const [toApprove, toReject] = await cfaAdmin.seedSubmittedApplications(program, 2, 'san1607');
      const table = new SubmissionsTablePage(adminPage);
      await table.goto(program);
      await expect(table.row(toApprove.id)).toContainText('Submitted');
      await expect(table.row(toReject.id)).toContainText('Submitted');

      await table.openDetail(toApprove.id);
      const appNo = await table.applicationNumber(toApprove.id);
      expect(appNo).toMatch(/^APP\d+$/);
      await expect(table.detailTitle).toContainText(`#${appNo}`);
      await expect(table.detailFrame.getByText(toApprove.email)).toBeVisible({ timeout: 20_000 });
      await table.closeDetail();

      const juryId = await cfaAdmin.adminUserId(adminAccount('jury')!.email);
      await cfaAdmin.addJuryToRound(r1, juryId);

      /* Approve: Move to Round via the UI (allotment needs the app in a round first — P5). */
      const moved = await table.moveToRound(toApprove.id, r1);
      expect(moved.response.ok(), `moveApplicationToNextRound → ${moved.response.status()}`).toBe(true);
      expect(moved.json?.errorMessage ?? null).toBeNull();
      const approved = await cfaAdmin.applicationStatus(program.uuid, toApprove.email);
      expect(approved.data).toMatchObject({
        applicationStatus: 'accepted',
        currentRoundId: Number(r1),
        isRejected: false,
      });
      await expect(table.row(toApprove.id)).toContainText('Accepted');

      await cfaAdmin.allotJury(program, r1, toApprove.id, juryId);
      const allotment = await cfaAdmin.juryAllotments(r1, toApprove.id);
      expect(allotment.allotmentIds, 'application allotted to QA jury').toHaveLength(1);
      expect(allotment.allottableJuryIds).not.toContain(juryId);

      await cfaAdmin.rejectApplications(program, [toReject.id], '[QA] SAN-1607 reject');
      const rejected = await cfaAdmin.applicationStatus(program.uuid, toReject.email);
      expect(rejected.data?.isRejected, JSON.stringify(rejected.data)).toBe(true);
      await table.goto(program);
      await expect(table.row(toReject.id)).toContainText(/Reject/i);
    } finally {
      if (program) await deleteCfaProgram(cfaAdmin, program.id);
    }
  });
});
