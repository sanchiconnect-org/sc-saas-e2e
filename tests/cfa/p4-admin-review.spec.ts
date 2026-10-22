/**
 * CFA regression suite P4 (FT-006 / SAN-1882): admin review and round transitions.
 * Owner: Ritu Raj
 * Pass bar: the table view and kanban list the submissions; moves, bulk moves, rejects, Tentative,
 * round resubmission, drafts and CSV import change what the admin table / drafts page / backend
 * status report afterwards; emails follow the round's silent-transfer setting (checked in the admin
 * email log, never a toast).
 *
 * One throwaway test-mode program with two rounds: R1 keeps the default silent_transfer 1 (no
 * applicant emails), R2 is set to 0 (emails sent). Every test seeds its own applications, so a
 * retry never sees another test's rows. Moves by the same admin must not run concurrently
 * (SAN-1893): run with --workers=1.
 */
import { cfaEmail, createCfaProgram, deleteCfaProgram, expect, test, type CfaProgram, type CfaRun } from '../../fixtures/cfa';
import { newestEmailLogRowId, waitForNewEmailLogRow } from '../../fixtures/email-log';
import { DraftsPage } from '../../pages/admin/cfa/DraftsPage';
import { SubmissionsTablePage } from '../../pages/admin/cfa/SubmissionsTablePage';
import { ApplicationStatusPage } from '../../pages/frontend/cfa/ApplicationStatusPage';
import { ProgramApplyPage } from '../../pages/frontend/cfa/ProgramApplyPage';
import { rand, tableRow } from './p3-helpers';

const TAGS = ['@regression', '@cfa', '@admin', '@write'];
const SUCCESS_EMAIL = 'application-program-management-success-email';
const REJECT_EMAIL = 'application-program-management-reject-email';
const RESUBMIT_EMAIL = 'resubmit-application';

function skipIfRunSkipped(run: CfaRun) {
  test.skip(!!run.skipReason, run.skipReason);
}

test.describe('CFA P4: admin review and round transitions', { tag: TAGS }, () => {
  let program: CfaProgram;
  let r1: string;
  let r2: string;
  let r1Name: string;
  let r2Name: string;

  test.beforeAll(async ({ cfaAdmin, cfaRun }) => {
    test.setTimeout(120_000);
    skipIfRunSkipped(cfaRun);
    program = await createCfaProgram(cfaAdmin, { runId: cfaRun.runId, label: 'p4-review', rounds: 2, ratingCriteriaOnLastRound: false });
    [r1, r2] = program.roundIds;
    await cfaAdmin.setRoundSilentTransfer(program, r2, false);
    const rounds = await cfaAdmin.programRounds(program);
    r1Name = rounds.find((r) => r.id === r1)!.name;
    r2Name = rounds.find((r) => r.id === r2)!.name;
  });

  test.afterAll(async ({ cfaAdmin }) => {
    if (program) await deleteCfaProgram(cfaAdmin, program.id);
  });

  test('the table view lists the seeded submissions as Submitted, outside any round', async ({ adminPage, cfaAdmin }) => {
    const seeded = await cfaAdmin.seedSubmittedApplications(program, 3, 'p4table');
    const table = new SubmissionsTablePage(adminPage);
    await table.goto(program);
    for (const app of seeded) {
      await expect(table.row(app.id)).toBeVisible();
      await expect(table.row(app.id)).toContainText('Submitted');
      expect(await table.applicationNumber(app.id)).toMatch(/^APP\d+$/);
    }
  });

  test('the kanban renders both round columns and the application cards', async ({ adminPage, cfaAdmin }) => {
    const [app] = await cfaAdmin.seedSubmittedApplications(program, 1, 'p4kanban');
    await cfaAdmin.moveToRound(program, [app.id], r1);
    const rounds = adminPage.waitForResponse(
      (r) => r.request().method() === 'POST' && (r.request().postData() ?? '').split('&').includes('submitAction=getProgramRounds'),
    );
    await adminPage.goto(`/application_management/submission-application-management/${program.id}/${program.adminSlug}`);
    expect((await rounds).ok()).toBe(true);
    const kanban = adminPage.locator('#kanban');
    await expect(kanban).toContainText(r1Name, { timeout: 20_000 });
    await expect(kanban).toContainText(r2Name);
    await expect(adminPage.locator(`#applicationId_${app.id}`)).toBeVisible({ timeout: 20_000 });
  });

  test('Move to Round into a round with silent transfer off mails the success email', async ({ adminPage, cfaAdmin }) => {
    /* Regression check for SAN-1912 (a PHP warning before the JSON stopped the page reloading). */
    const [app] = await cfaAdmin.seedSubmittedApplications(program, 1, 'p4loud');
    const before = await newestEmailLogRowId(adminPage, app.email, SUCCESS_EMAIL);
    const table = new SubmissionsTablePage(adminPage);
    await table.goto(program);
    const moved = await table.moveToRound(app.id, r2);
    expect(moved.response.ok()).toBe(true);
    expect(moved.json?.errorMessage ?? null).toBeNull();

    const row = await tableRow(cfaAdmin, program, (r) => r.submissionId === app.id);
    expect(row).toMatchObject({ status: 'Accepted', currentRound: r2Name });
    await waitForNewEmailLogRow(adminPage, app.email, SUCCESS_EMAIL, before);
  });

  test('a move into a silent-transfer round sends no email', async ({ adminPage, cfaAdmin }) => {
    const [silent, control] = await cfaAdmin.seedSubmittedApplications(program, 2, 'p4silent');
    await cfaAdmin.moveToRound(program, [silent.id], r1);
    await cfaAdmin.moveToRound(program, [control.id], r2);
    /* The control's email proves mails are flowing before the silent one's absence is read. */
    await waitForNewEmailLogRow(adminPage, control.email, SUCCESS_EMAIL, null);
    expect(await newestEmailLogRowId(adminPage, silent.email, SUCCESS_EMAIL), 'success email for the silent move').toBeNull();
    const row = await tableRow(cfaAdmin, program, (r) => r.submissionId === silent.id);
    expect(row).toMatchObject({ status: 'Accepted', currentRound: r1Name });
  });

  test('Bulk Move sends one request with every ticked application and moves them all', async ({ adminPage, cfaAdmin }) => {
    const seeded = await cfaAdmin.seedSubmittedApplications(program, 3, 'p4bulk');
    const table = new SubmissionsTablePage(adminPage);
    await table.goto(program);
    const moved = await table.bulkMoveToRound(seeded.map((a) => a.id), r1);
    expect(moved.response.ok()).toBe(true);
    expect(moved.sentIds.sort()).toEqual(seeded.map((a) => a.id).sort());
    if (moved.json) expect(moved.json.errorMessage ?? null).toBeNull();

    const rows = (await cfaAdmin.submittedApplications(program)).filter((r) => seeded.some((a) => a.id === r.submissionId));
    expect(rows.map((r) => [r.status, r.currentRound])).toEqual(seeded.map(() => ['Accepted', r1Name]));
  });

  test('Reject from a round with silent transfer off mails the reject email', async ({ adminPage, cfaAdmin }) => {
    const [app] = await cfaAdmin.seedSubmittedApplications(program, 1, 'p4reject');
    await cfaAdmin.moveToRound(program, [app.id], r2);
    const before = await newestEmailLogRowId(adminPage, app.email, REJECT_EMAIL);
    await cfaAdmin.rejectApplications(program, [app.id]);

    const row = await tableRow(cfaAdmin, program, (r) => r.submissionId === app.id);
    expect(row).toMatchObject({ status: 'Rejected', currentRound: r2Name });
    expect((await cfaAdmin.applicationStatus(program.uuid, app.email)).data?.isRejected).toBe(true);
    await waitForNewEmailLogRow(adminPage, app.email, REJECT_EMAIL, before);
  });

  test('Tentative (Hold Application) keeps the round and sets the status to Tentative', async ({ cfaAdmin }) => {
    const [app] = await cfaAdmin.seedSubmittedApplications(program, 1, 'p4tentative');
    await cfaAdmin.moveToRound(program, [app.id], r1);
    await cfaAdmin.markTentative(program, app.id);

    const row = await tableRow(cfaAdmin, program, (r) => r.submissionId === app.id);
    expect(row).toMatchObject({ status: 'Tentative', currentRound: r1Name });
    const status = await cfaAdmin.applicationStatus(program.uuid, app.email);
    expect(status.data).toMatchObject({ applicationStatus: 'tentative', currentRoundId: Number(r1) });
  });

  test('remove from evaluations is refused for a non-developer admin and the application stays', async ({ cfaAdmin }) => {
    const [app] = await cfaAdmin.seedSubmittedApplications(program, 1, 'p4remove');
    await expect(cfaAdmin.removeFromEvaluation(program, app.id)).rejects.toThrow(/permission/i);
    await tableRow(cfaAdmin, program, (r) => r.submissionId === app.id);
  });

  test('round resubmission mails resubmit-application and the application keeps its round', async ({ adminPage, cfaAdmin }) => {
    const [app] = await cfaAdmin.seedSubmittedApplications(program, 1, 'p4roundresubmit');
    await cfaAdmin.moveToRound(program, [app.id], r2);
    const row = await tableRow(cfaAdmin, program, (r) => r.submissionId === app.id);
    const before = await newestEmailLogRowId(adminPage, app.email, RESUBMIT_EMAIL);
    await cfaAdmin.sendForRoundResubmission(program, { detailId: row.detailId, submissionId: app.id, name: app.name, email: app.email }, `[QA] P4 ${rand()}`);

    await waitForNewEmailLogRow(adminPage, app.email, RESUBMIT_EMAIL, before);
    const after = await tableRow(cfaAdmin, program, (r) => r.submissionId === app.id);
    expect(after.currentRound).toBe(r2Name);
  });

  test('the detail page shows what was imported for the application', async ({ adminPage, cfaAdmin }) => {
    const [app] = await cfaAdmin.seedSubmittedApplications(program, 1, 'p4detail');
    const row = await tableRow(cfaAdmin, program, (r) => r.submissionId === app.id);
    await adminPage.goto(`/application-submission-detail/${row.detailId}`);
    const body = adminPage.locator('body');
    await expect(body).toContainText(new RegExp(app.email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
    await expect(body).toContainText(new RegExp(app.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  });

  test('drafts page: Move to Submitted lists the draft as submitted, Delete removes a draft', async ({ adminPage, cfaAdmin }) => {
    /* Regression check for SAN-1912 (a PHP warning before the JSON stopped the page reloading). */
    const tag = `p4drafts${rand()}`;
    const rows = [1, 2].map((n) => ({ name: `QA ${tag} ${n}`, email: cfaEmail(program.runId, `${tag}_${n}`), companyName: `QA ${tag} Co ${n}` }));
    await cfaAdmin.importApplicationsCsv(program, rows);
    const drafts = await cfaAdmin.findDrafts(program, tag);
    const toSubmit = drafts.find((d) => d.email === rows[0].email)!;
    const toDelete = drafts.find((d) => d.email === rows[1].email)!;
    expect(toSubmit && toDelete, 'both imported drafts listed').toBeTruthy();

    const page = new DraftsPage(adminPage);
    await page.goto(program);
    expect((await page.moveToSubmitted(toSubmit.id)).success).toBe(true);
    /* The page reloads itself after each action. */
    await expect(page.row(toSubmit.id)).toHaveCount(0);
    expect((await page.deleteApplication(toDelete.id)).success).toBe(true);
    await expect(page.row(toDelete.id)).toHaveCount(0);

    expect(await cfaAdmin.findDrafts(program, tag), 'no drafts left').toEqual([]);
    const submitted = (await cfaAdmin.submittedApplications(program)).filter((r) => [toSubmit.id, toDelete.id].includes(r.submissionId));
    expect(submitted.map((r) => [r.submissionId, r.status])).toEqual([[toSubmit.id, 'Submitted']]);
  });

  test('Import Applications (CSV) through the UI adds the rows as drafts', async ({ adminPage, cfaAdmin }) => {
    const tag = `p4import${rand()}`;
    const rows = [1, 2].map((n) => [`QA ${tag} ${n}`, cfaEmail(program.runId, `${tag}_${n}`), '', '', `QA ${tag} Co ${n}`]);
    const csv = [['Name', 'Email', 'Country Code', 'Mobile Number', 'Company Name'], ...rows].map((r) => r.join(',')).join('\n') + '\n';
    const table = new SubmissionsTablePage(adminPage);
    await table.goto(program);
    const imported = await table.importCsv({ name: 'qa-p4-import.csv', buffer: Buffer.from(csv) });
    expect(imported.success, imported.errorMessage ?? '').toBe(true);

    const drafts = await cfaAdmin.findDrafts(program, tag);
    expect(drafts.map((d) => d.email).sort()).toEqual(rows.map((r) => r[1]).sort());
  });

  test('the applicant sees the round change on the PWA status view', { tag: ['@frontend'] }, async ({ cfaAdmin, cfaFlags, page }) => {
    test.skip(!cfaFlags.application_management_round_status_updates, 'application_management_round_status_updates is off: the PWA renders no round tabs');
    const [app] = await cfaAdmin.seedSubmittedApplications(program, 1, 'p4applicant');
    await cfaAdmin.moveToRound(program, [app.id], r2);

    const apply = new ProgramApplyPage(page);
    await apply.useGuestIdentity(program.uuid, { email: app.email, name: app.name });
    const status = new ApplicationStatusPage(page);
    const details = status.waitForDetails(program.uuid);
    await apply.goto(program.code, program.slug);
    expect((await ApplicationStatusPage.details(await details)).currentRoundId).toBe(Number(r2));
    await expect(status.roundTab(r2Name)).toBeVisible();
  });
});

test.describe('CFA P4: freezing a round', { tag: TAGS }, () => {
  test('Freeze Application persists on the round and blocks moving its applications out', async ({ adminPage, cfaAdmin, cfaRun }) => {
    test.setTimeout(120_000);
    skipIfRunSkipped(cfaRun);
    /* There is no in-app unfreeze, so the round lives on its own throwaway program. */
    const program = await createCfaProgram(cfaAdmin, { runId: cfaRun.runId, label: 'p4-freeze', rounds: 2, ratingCriteriaOnLastRound: false });
    try {
      const [r1, r2] = program.roundIds;
      const [app] = await cfaAdmin.seedSubmittedApplications(program, 1, 'p4freeze');
      await cfaAdmin.moveToRound(program, [app.id], r1);
      await cfaAdmin.setRoundFreeze(program, r1, true);

      await adminPage.goto(`/application_management/edit_program_round/${r1}`);
      await expect(adminPage.locator('input#freeze_applications')).toBeChecked();
      await expect(cfaAdmin.moveToRound(program, [app.id], r2)).rejects.toThrow();
      const row = (await cfaAdmin.submittedApplications(program)).find((r) => r.submissionId === app.id);
      expect(row?.currentRound).toContain('[QA] R1-');
    } finally {
      await deleteCfaProgram(cfaAdmin, program.id);
    }
  });
});
