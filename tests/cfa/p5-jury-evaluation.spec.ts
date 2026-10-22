/**
 * CFA regression suite P5 (FT-006 / SAN-1883): jury and evaluation.
 * Owner: Ritu Raj
 * Pass bar: the QA jury is added to a round and allotted / de-allocated per application (read back from
 * the admin's Allot Jury modal and the jury's own sidebar); auto allot allots applications moved into the
 * round; the jury rates an application in its own browser context and the score and comment reach the
 * ratings report xlsx; with Limit Jury Access on, the jury only sees what is allotted to it; a Mandatory
 * jury NDA hides the round until the jury signs.
 *
 * One throwaway test-mode program with two rounds: R2 has the rating criterion and a jury question,
 * R1 is used for auto allot (so R2's allotments stay manual). Every test seeds its own applications.
 * Moves by the same admin must not run concurrently (SAN-1893): run with --workers=1.
 */
import * as fs from 'fs';
import * as path from 'path';
import { type Browser, type Page } from '@playwright/test';
import * as XLSX from 'xlsx';
import { adminAccount, authFile } from '../../config/accounts';
import { env } from '../../config/env';
import { createCfaProgram, deleteCfaProgram, expect, test, type CfaAdmin, type CfaProgram, type CfaRun } from '../../fixtures/cfa';
import { JuryRoundApplicationsPage } from '../../pages/admin/cfa/JuryRoundApplicationsPage';

const TAGS = ['@regression', '@cfa', '@admin', '@jury', '@write'];

function skipIfRunSkipped(run: CfaRun) {
  test.skip(!!run.skipReason, run.skipReason);
}

/** A page in its own browser context on the saved jury session (.auth/jury.json), baseURL = ADMIN_URL. */
async function juryPage(browser: Browser): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ storageState: authFile('jury'), baseURL: env.adminUrl });
  return { page: await context.newPage(), close: () => context.close() };
}

function reportRows(xlsx: Buffer): string[][] {
  const book = XLSX.read(xlsx, { type: 'buffer' });
  return book.SheetNames.flatMap((name) =>
    XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[name], { header: 1, defval: '' }).map((row) => row.map((c) => String(c).trim())),
  );
}

test.describe('CFA P5: jury and evaluation', { tag: TAGS }, () => {
  let program: CfaProgram;
  let r1: string;
  let r2: string;
  let juryId: string;

  test.beforeAll(async ({ cfaAdmin, cfaRun }) => {
    test.setTimeout(120_000);
    skipIfRunSkipped(cfaRun);
    const jury = adminAccount('jury');
    test.skip(!jury, 'QA_JURY_EMAIL / QA_JURY_PASSWORD not set');
    juryId = await cfaAdmin.adminUserId(jury!.email);
    program = await createCfaProgram(cfaAdmin, { runId: cfaRun.runId, label: 'p5-jury', rounds: 2, ratingCriteriaOnLastRound: true });
    [r1, r2] = program.roundIds;
    await cfaAdmin.addJuryToRound(r2, juryId);
    await cfaAdmin.addJuryQuestion(program, r2, '[QA] P5 recommend?', 'boolean_only');
  });

  test.afterAll(async ({ cfaAdmin }) => {
    if (program) await deleteCfaProgram(cfaAdmin, program.id);
  });

  test('add_jury_member puts the QA jury on the round: the Allot Jury modal offers them', async ({ cfaAdmin }) => {
    const [app] = await cfaAdmin.seedSubmittedApplications(program, 1, 'p5member');
    await cfaAdmin.moveToRound(program, [app.id], r2);
    const allotment = await cfaAdmin.juryAllotments(r2, app.id);
    expect(allotment.allottableJuryIds).toContain(juryId);
    expect(allotment.allotmentIds).toEqual([]);
  });

  test('allot and de-allocate change the Allot Jury modal and the jury’s own list', async ({ browser, cfaAdmin }) => {
    const [app] = await cfaAdmin.seedSubmittedApplications(program, 1, 'p5allot');
    await cfaAdmin.moveToRound(program, [app.id], r2);
    const jury = await juryPage(browser);
    try {
      const list = new JuryRoundApplicationsPage(jury.page);

      await cfaAdmin.allotJury(program, r2, app.id, juryId);
      const allotted = await cfaAdmin.juryAllotments(r2, app.id);
      expect(allotted.allotmentIds).toHaveLength(1);
      expect(allotted.allottableJuryIds).not.toContain(juryId);
      await list.goto(program, r2);
      await expect(list.application(app.name)).toHaveCount(1);

      await cfaAdmin.deallocateJury(r2, app.id, allotted.allotmentIds[0]);
      const removed = await cfaAdmin.juryAllotments(r2, app.id);
      expect(removed.allotmentIds).toEqual([]);
      expect(removed.allottableJuryIds).toContain(juryId);
      await list.goto(program, r2);
      await expect(list.application(app.name)).toHaveCount(0);
    } finally {
      await jury.close();
    }
  });

  test('the jury rates an allotted application; the score and comment reach the ratings report', async ({ browser, cfaAdmin }) => {
    const [app] = await cfaAdmin.seedSubmittedApplications(program, 1, 'p5rate');
    await cfaAdmin.moveToRound(program, [app.id], r2);
    await cfaAdmin.allotJury(program, r2, app.id, juryId);
    const comment = `[QA] P5 rating ${app.email}`;

    const jury = await juryPage(browser);
    try {
      const list = new JuryRoundApplicationsPage(jury.page);
      await list.goto(program, r2);
      await list.application(app.name).click();
      await expect(list.ratingForm.locator(`input[name="data[submission_id]"][value="${app.id}"]`)).toHaveCount(1);
      const questionId = await list.ratingForm.locator('select[id^="question_"]').first().getAttribute('id');
      expect(questionId, 'the round question is on the rating form').toBeTruthy();

      const rated = await list.rate({ stars: 4, comment, answers: { [questionId!]: 'Yes' } });
      expect(rated.ok()).toBe(true);
      await list.goto(program, r2);
      await expect(list.application(app.name)).toHaveAttribute('data-is_rated', 'application_rated');
      /* The ratings report has no question columns; the saved answer is read back from the reopened form. */
      await list.application(app.name).click();
      await expect(list.ratingForm.locator(`select#${questionId}`), 'the saved question answer').toHaveValue('Yes');
    } finally {
      await jury.close();
    }

    const row = reportRows(await cfaAdmin.ratingsReport(program)).find((r) => r.includes(comment));
    expect(row, 'ratings report row with the jury comment').toBeTruthy();
    expect(row!.some((c) => /^4(\.0+)?$/.test(c)), `a 4-star score in ${JSON.stringify(row)}`).toBe(true);
  });

  test('auto allot: an application moved into the round is allotted to the auto-allot jury', async ({ cfaAdmin }) => {
    await cfaAdmin.addJuryToRound(r1, juryId);
    await cfaAdmin.setJuryAutoAllot(r1, juryId, true);
    try {
      const [app] = await cfaAdmin.seedSubmittedApplications(program, 1, 'p5auto');
      await cfaAdmin.moveToRound(program, [app.id], r1);
      const allotment = await cfaAdmin.juryAllotments(r1, app.id);
      expect(allotment.allotmentIds).toHaveLength(1);
      expect(allotment.allottableJuryIds).not.toContain(juryId);
    } finally {
      await cfaAdmin.setJuryAutoAllot(r1, juryId, false);
    }
  });

  test('Limit Jury Access: the jury sees only allotted applications and loses a de-allocated one', async ({ browser, cfaAdmin, cfaFlags }) => {
    test.skip(cfaFlags.limit_jury_access_enabled !== true, 'limit_jury_access_enabled is off on this tenant');
    const [kept, dropped] = await cfaAdmin.seedSubmittedApplications(program, 2, 'p5limit');
    await cfaAdmin.moveToRound(program, [kept.id, dropped.id], r2);

    const jury = await juryPage(browser);
    try {
      const list = new JuryRoundApplicationsPage(jury.page);

      await cfaAdmin.allotJury(program, r2, dropped.id, juryId);
      await list.goto(program, r2);
      const droppedUrl = await list.application(dropped.name).getAttribute('href');
      expect(droppedUrl).toBeTruthy();
      await expect(list.application(kept.name), 'an unallotted application in the jury list').toHaveCount(0);

      const allotment = await cfaAdmin.juryAllotments(r2, dropped.id);
      await cfaAdmin.deallocateJury(r2, dropped.id, allotment.allotmentIds[0]);
      await cfaAdmin.allotJury(program, r2, kept.id, juryId);

      await list.goto(program, r2);
      await expect(list.application(kept.name)).toHaveCount(1);
      await expect(list.application(dropped.name)).toHaveCount(0);

      await jury.page.goto(droppedUrl!);
      await expect(
        list.ratingForm.locator(`input[name="data[submission_id]"][value="${dropped.id}"]`),
        'the de-allocated application still opens for rating by direct URL',
      ).toHaveCount(0);
    } finally {
      await jury.close();
    }
  });
});

/*
 * Jury NDA only runs on the long-lived "[QA] CFA NDA (do not delete)" program (QA_CFA_NDA_PROGRAM_ID):
 * NDA rows make deleteApplicationProgram refuse, so never on a per-run or throwaway program. That program
 * was set up once by hand: one round with a Mandatory NDA, the QA jury on it and one application allotted
 * to them (knowledge.md). Each run replaces the NDA with "sign again", so the jury always starts unsigned.
 */
test.describe('CFA P5: jury NDA (long-lived program)', { tag: TAGS }, () => {
  /**
   * Replaces the NDA program's round NDA with "sign again", so the QA jury is unsigned.
   * Returns the program, its round and the name the jury must type to sign.
   */
  async function resetNda(cfaAdmin: CfaAdmin) {
    const programId = env.cfa.ndaProgramId;
    test.skip(!programId, 'QA_CFA_NDA_PROGRAM_ID not set');
    const juryAccount = adminAccount('jury');
    test.skip(!juryAccount, 'QA_JURY_EMAIL / QA_JURY_PASSWORD not set');
    const program = { id: programId! };
    expect(await cfaAdmin.programExists(program.id), `NDA program ${program.id} (QA_CFA_NDA_PROGRAM_ID) not found`).toBe(true);
    /* The slug in the submissions URL is not checked. */
    const [round] = await cfaAdmin.programRounds({ id: program.id, adminSlug: 'x' });
    expect(round, `NDA program ${program.id} has no round`).toBeTruthy();
    const juryName = (await cfaAdmin.adminUser(juryAccount!.email)).name;

    /* A trailing comment after %%EOF keeps every run's PDF distinct; readers ignore it. */
    const pdf = Buffer.concat([
      fs.readFileSync(path.resolve(__dirname, '../../fixtures/files/qa-pitch-deck.pdf')),
      Buffer.from(`\n% qa-nda ${new Date().toISOString()}\n`),
    ]);
    await cfaAdmin.replaceJuryNda(program, round.id, { name: 'qa-nda.pdf', buffer: pdf }, true);
    return { program, round, juryName };
  }

  test('the NDA modal opens within 15 s of the gate', async ({ browser, cfaAdmin }) => {
    const { program, round } = await resetNda(cfaAdmin);
    const jury = await juryPage(browser);
    try {
      const list = new JuryRoundApplicationsPage(jury.page);
      await list.goto(program, round.id);
      await expect(list.ndaModal).toBeVisible({ timeout: 15_000 });
    } finally {
      await jury.close();
    }
  });

  test('a Mandatory NDA hides the round until the jury signs; after signing the allotted application opens', async ({ browser, cfaAdmin }) => {
    test.setTimeout(180_000);
    const { program, round, juryName } = await resetNda(cfaAdmin);

    const jury = await juryPage(browser);
    try {
      const list = new JuryRoundApplicationsPage(jury.page);
      await list.goto(program, round.id);
      await expect(list.ratingForm, 'the rating form behind an unsigned NDA').toHaveCount(0);
      await expect(list.ndaModal).toBeVisible({ timeout: 15_000 });
      await expect(list.ratingForm, 'the rating form behind an unsigned NDA').toHaveCount(0);

      const accepted = await list.signNda(juryName);
      expect(accepted.status()).toBe(200);

      await expect(list.ratingForm).toBeVisible({ timeout: 30_000 });
      await expect(list.ndaModal).toBeHidden();
      expect(await list.openSubmissionId()).toBeTruthy();
    } finally {
      await jury.close();
    }
  });
});
