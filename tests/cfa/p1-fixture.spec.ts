/**
 * CFA regression suite P1 (FT-006 / SAN-1879): the per-run program fixture and its helpers.
 * Owner: Ritu Raj
 * Pass bar: the per-run program is test-mode and live, hidden from /call-for-applications but
 * reachable by direct URL; the admin submitAction helper fails loudly; CSV seeding is fast;
 * the factory and the orphan sweep delete what they should and nothing else.
 *
 * Teardown of the per-run program itself is asserted in tests/cfa.teardown.ts.
 */
import { authFile } from '../../config/accounts';
import { env } from '../../config/env';
import {
  cfaPrerequisiteSkipReason,
  cfaProgramTitle,
  createCfaProgram,
  deleteCfaProgram,
  expect,
  newCfaRunId,
  runIdFromTitle,
  sweepOrphanPrograms,
  test,
} from '../../fixtures/cfa';
import { ProgramWizardPage } from '../../pages/admin/cfa/ProgramWizardPage';
import { CallForApplicationsPage } from '../../pages/frontend/cfa/CallForApplicationsPage';
import { ProgramApplyPage } from '../../pages/frontend/cfa/ProgramApplyPage';

test.describe('CFA fixture: the per-run program', { tag: ['@regression', '@cfa', '@write'] }, () => {
  test('cfa-setup recorded a complete program with two rounds', async ({ cfaRun, cfaProgram }) => {
    for (const key of ['id', 'uuid', 'code', 'slug', 'formId', 'formUUID'] as const) {
      expect(cfaProgram[key], `run.json program.${key}`).toBeTruthy();
    }
    expect(cfaProgram.roundIds).toHaveLength(2);
    expect(cfaProgram.title).toBe(cfaProgramTitle(cfaRun.runId));
    expect(cfaRun.flags, 'flags read from resolve-domain').toBeDefined();
  });

  test('the program is in test mode and live', { tag: '@admin' }, async ({ browser, cfaAdmin, cfaProgram }) => {
    const backend = await cfaAdmin.programByCode(cfaProgram.code);
    expect(backend.status).toBe(200);
    expect(backend.data?.uuid).toBe(cfaProgram.uuid);
    expect(backend.data?.testModeEnabled).toBe(true);
    expect(backend.data?.status).toBe(true);

    const context = await browser.newContext({ storageState: authFile('admin'), baseURL: env.adminUrl });
    try {
      const wizard = new ProgramWizardPage(await context.newPage());
      await wizard.gotoFinalize(cfaProgram.id, cfaProgram.adminSlug);
      await expect(wizard.testModeHeading).toBeVisible();
      await expect(wizard.disableTestModeButton).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('an anonymous visitor does not see it on /call-for-applications', { tag: '@frontend' }, async ({ page, cfaProgram }) => {
    const list = new CallForApplicationsPage(page);
    const response = await list.goto();
    expect(response.ok()).toBe(true);

    const programs: { uuid?: string; programCode?: string }[] = (await response.json())?.data ?? [];
    expect(programs.map((p) => p.uuid)).not.toContain(cfaProgram.uuid);
    expect(programs.map((p) => p.programCode)).not.toContain(cfaProgram.code);
    await expect(list.programCard(cfaProgram.title)).toHaveCount(0);
  });

  test('an anonymous visitor opens its apply page by direct URL', { tag: '@frontend' }, async ({ page, cfaProgram }) => {
    const apply = new ProgramApplyPage(page);
    await apply.goto(cfaProgram.code, cfaProgram.slug);
    await expect(apply.programTitle(cfaProgram.title)).toBeVisible({ timeout: 20_000 });
  });
});

test.describe('CFA fixture: admin helpers', { tag: ['@regression', '@cfa', '@write', '@admin'] }, () => {
  test('submitAction returns the parsed JSON body', async ({ cfaAdmin, cfaProgram }) => {
    /* Re-enabling test mode on a test-mode program changes nothing. */
    const json = await cfaAdmin.submitAction(
      `/application_management/program/${cfaProgram.id}/edit/${cfaProgram.adminSlug}`,
      'changeTestMode',
      { action: 'enable', programId: cfaProgram.id },
    );
    expect(json).toMatchObject({ error: false, success: true });
  });

  test('submitAction fails loudly when the body says error: true', async ({ cfaAdmin, cfaProgram }) => {
    /* createProgramRound without roundTitle answers HTTP 200 + {"error":true,"errorMessage":"Round Title is required"}. */
    await expect(
      cfaAdmin.submitAction(
        `/application_management/submission-application-management/${cfaProgram.id}/${cfaProgram.adminSlug}`,
        'createProgramRound',
        { programId: cfaProgram.id, roundTitle: '' },
      ),
    ).rejects.toThrow(/createProgramRound failed: Round Title is required/);
  });

  test('submitAction fails loudly on a missing program id', async ({ cfaAdmin, cfaProgram }) => {
    await expect(
      cfaAdmin.submitAction(
        `/application_management/program/${cfaProgram.id}/edit/${cfaProgram.adminSlug}`,
        'makeProgramLive',
        { programId: '' },
      ),
    ).rejects.toThrow(/makeProgramLive failed: Program Id is required/);
  });

  test('CSV import + moveToSubmitted seed 3 submitted applications in under 15s', async ({ cfaAdmin, cfaProgram }) => {
    const started = Date.now();
    const seeded = await cfaAdmin.seedSubmittedApplications(cfaProgram, 3, 'p1seed');
    const elapsed = Date.now() - started;

    expect(seeded).toHaveLength(3);
    expect(new Set(seeded.map((s) => s.id)).size).toBe(3);
    for (const s of seeded) expect(s.email).toMatch(new RegExp(`^sc_cfa_${cfaProgram.runId.replace(/-/g, '_')}_p1seed`));
    /* Submitted rows leave the drafts page. */
    const tag = seeded[0].name.split(' ')[1];
    expect(await cfaAdmin.findDrafts(cfaProgram, tag)).toEqual([]);
    expect(elapsed, `seeding took ${elapsed}ms`).toBeLessThan(15_000);
  });

  test('seedSubmittedApplications rejects a count outside 1-10', async ({ cfaAdmin, cfaProgram }) => {
    await expect(cfaAdmin.seedSubmittedApplications(cfaProgram, 0)).rejects.toThrow(/count must be 1-10/);
    await expect(cfaAdmin.seedSubmittedApplications(cfaProgram, 11)).rejects.toThrow(/count must be 1-10/);
  });
});

test.describe('CFA fixture: program lifecycle', { tag: ['@regression', '@cfa', '@write', '@admin'] }, () => {
  test('createCfaProgram makes a throwaway program and deleteCfaProgram removes it', async ({ cfaAdmin, cfaRun }) => {
    test.setTimeout(120_000);
    const throwaway = await createCfaProgram(cfaAdmin, { runId: cfaRun.runId, label: 'p1-factory', rounds: 1, bypassOtp: true });
    try {
      expect(throwaway.title).toBe(cfaProgramTitle(cfaRun.runId, 'p1-factory'));
      expect(throwaway.roundIds).toHaveLength(1);
      expect(await cfaAdmin.programExists(throwaway.id)).toBe(true);
      const backend = await cfaAdmin.programByCode(throwaway.code);
      expect(backend.data?.bypassOTPVerification).toBe(true);
      expect(backend.data?.allowReapplication).toBe(true);
      expect(backend.data?.reapplicationDurationType).toBe('immediate');
    } finally {
      await deleteCfaProgram(cfaAdmin, throwaway.id);
    }
    expect(await cfaAdmin.programExists(throwaway.id)).toBe(false);
    expect((await cfaAdmin.programByCode(throwaway.code)).status).toBe(404);
  });

  test('the orphan sweep deletes [QA] CFA run-* programs older than 24h and keeps newer ones', async ({ cfaAdmin, cfaProgram }) => {
    /* A bare draft program (never live, never listed) named like a run that started 25h ago. */
    const oldRunId = newCfaRunId(new Date(Date.now() - 25 * 60 * 60 * 1000));
    const created = await cfaAdmin.submitAction('/table/application_programs', 'createApplicationProgram', {
      programName: cfaProgramTitle(oldRunId, 'p1-orphan'),
    });
    const orphanId = /program\/(\d+)\/edit\//.exec(created.editUrl ?? '')?.[1];
    expect(orphanId, 'orphan program id').toBeTruthy();

    try {
      const deleted = await sweepOrphanPrograms(cfaAdmin);
      expect(deleted).toContain(orphanId);
      expect(await cfaAdmin.programExists(orphanId!)).toBe(false);
      /* This run's program is under 24h old and must survive the sweep. */
      expect(deleted).not.toContain(cfaProgram.id);
      expect(await cfaAdmin.programExists(cfaProgram.id)).toBe(true);
    } finally {
      if (await cfaAdmin.programExists(orphanId!)) await deleteCfaProgram(cfaAdmin, orphanId!);
    }
  });
});

test.describe('CFA fixture: pure helpers', { tag: ['@regression', '@cfa'] }, () => {
  test('a missing admin secret or template form id is a skip reason, not a failure', () => {
    expect(cfaPrerequisiteSkipReason({ adminConfigured: false, templateFormId: '12' })).toMatch(/QA_ADMIN_EMAIL/);
    expect(cfaPrerequisiteSkipReason({ adminConfigured: true, templateFormId: undefined })).toMatch(/QA_CFA_TEMPLATE_FORM_ID/);
    expect(cfaPrerequisiteSkipReason({ adminConfigured: true, templateFormId: '' })).toMatch(/QA_CFA_TEMPLATE_FORM_ID/);
    expect(cfaPrerequisiteSkipReason({ adminConfigured: true, templateFormId: '12' })).toBeUndefined();
  });

  test('only "[QA] CFA run-<runId>" titles are recognised as suite programs', () => {
    expect(runIdFromTitle('[QA] CFA run-20261012-1530-ab12')).toBe('20261012-1530-ab12');
    expect(runIdFromTitle('[QA] CFA run-20261012-1530-ab12 freeze')).toBe('20261012-1530-ab12');
    expect(runIdFromTitle('[QA] CFA Closed (do not delete)')).toBeNull();
    expect(runIdFromTitle('[QA] CFA NDA (do not delete)')).toBeNull();
    expect(runIdFromTitle('[QA] CFA run-probe')).toBeNull();
    expect(runIdFromTitle('CFA run-20261012-1530-ab12')).toBeNull();
    expect(runIdFromTitle('')).toBeNull();
  });
});
