/**
 * Startup regression path, journey 5 of 5 (SAN-1606): the startup receives the decisions on its
 * application.
 * Owner: Ritu Raj
 * Pass bar: when the admin accepts the application into a round that mails the applicant, the
 * success email is logged for the startup's address and the backend reports "accepted"; when
 * the admin then rejects it, the reject email is logged, the status check the startup's apply
 * page makes reports the rejection, its reason, and that re-application is allowed, and the page
 * shows "Your previous application was rejected" with Reapply Now.
 *
 * One account holds one live application per program, so both decisions land on the same
 * application of one throwaway program (round 1 with silent transfer off), deleted at the end.
 * Emails are checked in the admin email log, never a toast. Moves by the same admin must not run
 * concurrently (SAN-1893): run with --workers=1.
 */
import { authFile } from '../../config/accounts';
import { deleteCfaProgram, editProgramForm, expect, test, wizardPath } from '../../fixtures/cfa';
import { newestEmailLogRowId, waitForNewEmailLogRow } from '../../fixtures/email-log';
import { ApplicationStatusPage } from '../../pages/frontend/cfa/ApplicationStatusPage';
import { ProgramApplyPage } from '../../pages/frontend/cfa/ProgramApplyPage';
import { REJECT_EMAIL, SUCCESS_EMAIL, applyAsStartup, createPathProgram, startup } from './startup-path-helpers';

test.describe('startup path: receive the decision', { tag: ['@regression', '@cfa', '@frontend', '@startup', '@write'] }, () => {
  test.skip(!startup, 'QA_STARTUP_EMAIL not set');
  test.use({ storageState: authFile('startup') });

  test('accepted into a round, then rejected: both emails are logged and the PWA shows the rejection', async ({
    adminPage,
    cfaAdmin,
    cfaRun,
    page,
  }) => {
    test.setTimeout(240_000);
    const program = await createPathProgram(cfaAdmin, cfaRun.runId, 'decision');
    try {
      const [r1] = program.roundIds;
      await cfaAdmin.setRoundSilentTransfer(program, r1, false);
      const { submissionId } = await applyAsStartup(page, program);
      const email = startup!.email;

      const beforeSuccess = await newestEmailLogRowId(adminPage, email, SUCCESS_EMAIL);
      await cfaAdmin.moveToRound(program, [submissionId], r1);
      await waitForNewEmailLogRow(adminPage, email, SUCCESS_EMAIL, beforeSuccess);
      expect((await cfaAdmin.applicationStatus(program.uuid, email)).data).toMatchObject({
        applicationStatus: 'accepted',
        currentRoundId: Number(r1),
        isRejected: false,
      });

      const beforeReject = await newestEmailLogRowId(adminPage, email, REJECT_EMAIL);
      await cfaAdmin.rejectApplications(program, [submissionId]);
      await waitForNewEmailLogRow(adminPage, email, REJECT_EMAIL, beforeReject);

      const apply = new ProgramApplyPage(page);
      const status = new ApplicationStatusPage(page);
      const details = status.waitForDetails(program.uuid);
      await apply.goto(program.code, program.slug);
      expect(await ApplicationStatusPage.details(await details)).toMatchObject({
        submissionId: Number(submissionId),
        isRejected: true,
        applicationStatus: 'rejected',
        rejectionMessage: '[QA] rejected by the CFA suite',
        allowReapplication: true,
        canReapplyNow: true,
      });
      await expect(apply.rejectedNotice).toBeVisible();
      await expect(apply.reapplyNowButton).toBeVisible();

      /* Edge: re-application off — notice stays, Reapply Now is hidden. */
      await cfaAdmin.submitAction(
        wizardPath(program),
        'editProgram',
        editProgramForm({ title: program.title, runId: program.runId, allowReapplication: false }),
      );
      const detailsOff = status.waitForDetails(program.uuid);
      await page.reload();
      const afterOff = await ApplicationStatusPage.details(await detailsOff);
      expect(afterOff).toMatchObject({ isRejected: true, allowReapplication: false, canReapplyNow: false });
      await expect(apply.rejectedNotice).toBeVisible();
      await expect(apply.reapplyNowButton).toBeHidden();
    } finally {
      await deleteCfaProgram(cfaAdmin, program.id);
    }
  });
});
