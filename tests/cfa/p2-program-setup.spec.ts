/**
 * CFA regression suite P2 (FT-006 / SAN-1880): program setup, wizard and rounds (admin).
 * Owner: Ritu Raj
 * Pass bar: every program- or round-level change is made on a throwaway program of its own,
 * the change is read back after a reload (the admin answers HTTP 200 + "success" even when a
 * Medoo write silently fails, SAN-1865), and every throwaway is deleted in afterAll.
 *
 * Writes go through the admin's own UI where FT-006 asks for a UI step (create, edit details,
 * evaluation settings, round editor, test mode, Go Live, close/reopen, close program), and
 * through the same submitAction POST the UI sends everywhere else.
 */
import {
  CfaAdmin,
  cfaProgramTitle,
  createBareCfaProgram,
  createCfaProgram,
  deleteCfaProgram,
  editProgramForm,
  expect,
  importTemplateFields,
  programApplyInfo,
  recordProgram,
  test,
  wizardPath,
  type CfaProgram,
  type CfaRun,
} from '../../fixtures/cfa';
import { type Locator } from '@playwright/test';
import { ProgramsTablePage } from '../../pages/admin/cfa/ProgramsTablePage';
import { ProgramWizardPage } from '../../pages/admin/cfa/ProgramWizardPage';
import { RoundEditorPage } from '../../pages/admin/cfa/RoundEditorPage';
import { CallForApplicationsPage } from '../../pages/frontend/cfa/CallForApplicationsPage';
import { ProgramApplyPage } from '../../pages/frontend/cfa/ProgramApplyPage';

const TAGS = ['@regression', '@cfa', '@write', '@admin'];

/** A short random tag, alphanumeric only so the admin search does a substring match. */
const rand = () => Math.random().toString(36).slice(2, 8);

/** Admin program-list search term that matches exactly one throwaway: "CFA run-<runId> <label>". */
const searchFor = (p: { title: string }) => p.title.replace(/^\[QA\] /, '');

/** Skips a describe's beforeAll (and so its tests) when cfa-setup recorded a skip reason. */
function skipIfRunSkipped(run: CfaRun) {
  test.skip(!!run.skipReason, run.skipReason);
}

test.describe('CFA P2: create a program', { tag: TAGS }, () => {
  test('the admin creates a program from the program list and lands on its wizard', async ({ adminPage, cfaAdmin, cfaRun }) => {
    const title = cfaProgramTitle(cfaRun.runId, `p2-ui-create-${rand()}`);
    const table = new ProgramsTablePage(adminPage);
    await table.goto();

    const created = await table.createProgram(title);
    expect(created).toMatchObject({ error: false, success: true });
    const [, id] = /\/application_management\/program\/(\d+)\/edit\//.exec(created.editUrl ?? '') ?? [];
    expect(id, `program id in editUrl ${created.editUrl}`).toBeTruthy();
    recordProgram({ id, title, runId: cfaRun.runId });

    try {
      /* The page follows editUrl to the wizard's first step, which shows the saved title. */
      await expect(adminPage).toHaveURL(new RegExp(`/application_management/program/${id}/edit/`), { timeout: 15_000 });
      await expect(new ProgramWizardPage(adminPage).titleInput).toHaveValue(title);

      const listed = await cfaAdmin.listPrograms(searchFor({ title }));
      expect(listed).toContainEqual({ id, title });
      /* A new program is a draft: listed under Draft, not Live. */
      expect((await cfaAdmin.listProgramsInTab('draft', title)).map((p) => p.id)).toContain(id);
      expect((await cfaAdmin.listProgramsInTab('live', title)).map((p) => p.id)).not.toContain(id);
    } finally {
      await deleteCfaProgram(cfaAdmin, id);
    }
  });

  test('an empty program title is refused', async ({ cfaAdmin }) => {
    await expect(cfaAdmin.submitAction('/table/application_programs', 'createApplicationProgram', { programName: '' })).rejects.toThrow(
      /createApplicationProgram failed: Program Title is required/,
    );
  });
});

test.describe('CFA P2: program wizard', { tag: TAGS }, () => {
  test.describe.configure({ mode: 'serial' });
  let program: CfaProgram;

  test.beforeAll(async ({ cfaAdmin, cfaRun }) => {
    skipIfRunSkipped(cfaRun);
    program = await createCfaProgram(cfaAdmin, { runId: cfaRun.runId, label: 'p2-wizard', rounds: 1, ratingCriteriaOnLastRound: false });
  });

  test.afterAll(async ({ cfaAdmin }) => {
    if (program) await deleteCfaProgram(cfaAdmin, program.id);
  });

  test('basic details saved in the wizard (editProgram) survive a reload', async ({ adminPage, cfaAdmin }) => {
    const wizard = new ProgramWizardPage(adminPage);
    await wizard.gotoEdit(program.id, program.adminSlug);
    await expect(wizard.titleInput).toHaveValue(program.title);

    /* Keep the "[QA] CFA run-<runId>" prefix so teardown still recognises the program. */
    const newTitle = `${program.title} edited`;
    const newBrief = `QA brief ${rand()}`;
    await wizard.titleInput.fill(newTitle);
    await wizard.shortDescriptionInput.fill(newBrief);
    await wizard.displayOrderInput.fill('7');
    expect(await wizard.saveBasicDetails()).toMatchObject({ error: false, success: true });

    await wizard.gotoEdit(program.id, program.adminSlug);
    await expect(wizard.titleInput).toHaveValue(newTitle);
    await expect(wizard.shortDescriptionInput).toHaveValue(newBrief);
    await expect(wizard.displayOrderInput).toHaveValue('7');

    const backend = await cfaAdmin.programByCode(program.code);
    expect(backend.data?.programTitle).toBe(newTitle);
    expect(backend.data?.shortDescription).toBe(newBrief);
    program = { ...program, title: newTitle };
  });

  test('a missing program brief is refused by editProgram', async ({ cfaAdmin }) => {
    await expect(
      cfaAdmin.submitAction(wizardPath(program), 'editProgram', editProgramForm({ title: program.title, runId: program.runId }, { short_description: '' })),
    ).rejects.toThrow(/editProgram failed: Program brief is required/);
  });

  test('evaluation settings saved in the wizard (editEvaluation) survive a reload', async ({ adminPage }) => {
    const wizard = new ProgramWizardPage(adminPage);
    await wizard.gotoFinalize(program.id, program.adminSlug);

    const switches = ['auto_communication', 'editable_jury_ratings'];
    const before: Record<string, boolean> = {};
    for (const id of switches) before[id] = await wizard.evaluationSwitch(id).isChecked();
    for (const id of switches) await wizard.toggleEvaluationSwitch(id);
    expect(await wizard.saveEvaluation()).toMatchObject({ error: false, success: true });

    await wizard.gotoFinalize(program.id, program.adminSlug);
    for (const id of switches) {
      await expect(wizard.evaluationSwitch(id), `${id} after reload`).toBeChecked({ checked: !before[id] });
    }
  });
});

test.describe('CFA P2: rounds', { tag: TAGS }, () => {
  test.describe.configure({ mode: 'serial' });
  let program: CfaProgram;
  let roundId: string;
  const roundName = `[QA] P2 round ${rand()}`;

  test.beforeAll(async ({ cfaAdmin, cfaRun }) => {
    skipIfRunSkipped(cfaRun);
    program = await createCfaProgram(cfaAdmin, { runId: cfaRun.runId, label: 'p2-rounds', rounds: 1, ratingCriteriaOnLastRound: false });
  });

  test.afterAll(async ({ cfaAdmin }) => {
    if (program) await deleteCfaProgram(cfaAdmin, program.id);
  });

  test('a new round appears in the program round list', async ({ cfaAdmin }) => {
    roundId = await cfaAdmin.createRound(program, roundName);
    const rounds = await cfaAdmin.programRounds(program);
    expect(rounds.map((r) => r.id)).toEqual([...program.roundIds, roundId]);
    expect(rounds.find((r) => r.id === roundId)?.name).toBe(roundName);
  });

  test('a round with an empty title is refused', async ({ cfaAdmin }) => {
    await expect(cfaAdmin.createRound(program, '')).rejects.toThrow(/createProgramRound failed: Round Title is required/);
  });

  test('a round with a whitespace-only title is refused', async ({ cfaAdmin }) => {
    /* createProgramRound checks `trim(($_POST['roundTitle']) == "")`: the parentheses make it
       trim(bool), so "   " passes the required check and clean() then stores an empty round
       name (submission-application-management.php:286). Known-failing until SAN-1890. */
    test.fail(true, 'createProgramRound accepts a whitespace-only round title: SAN-1890');
    let createdId: string | undefined;
    try {
      await expect(
        cfaAdmin.createRound(program, '   ').then((id) => {
          createdId = id;
          return id;
        }),
      ).rejects.toThrow(/createProgramRound failed: Round Title is required/);
    } finally {
      if (createdId) await cfaAdmin.deleteRound(program, createdId);
    }
  });

  test('a second round with the same name is allowed', async ({ cfaAdmin }) => {
    /* Round names are NOT unique per program, by product decision (2026-10-12, FT-006 spec
       correction). createProgramRound has no duplicate check and the round entity no unique
       index. Rounds are told apart by id, so a duplicate name is a separate round. */
    const dupName = `[QA] P2 dup round ${rand()}`;
    const created: string[] = [];
    try {
      created.push(await cfaAdmin.createRound(program, dupName));
      created.push(await cfaAdmin.createRound(program, dupName));
      expect(created[0]).not.toBe(created[1]);
      const rounds = await cfaAdmin.programRounds(program);
      expect(rounds.filter((r) => r.name === dupName).map((r) => r.id).sort()).toEqual([...created].sort());
    } finally {
      for (const id of created) await cfaAdmin.deleteRound(program, id);
    }
  });

  test('round settings edited in the round editor persist', async ({ adminPage, cfaAdmin }) => {
    const editor = new RoundEditorPage(adminPage);
    await editor.goto(roundId);
    await expect(editor.roundNameInput).toHaveValue(roundName);

    const renamed = `${roundName} renamed`;
    await editor.roundNameInput.fill(renamed);
    await editor.chooseSilentTransfer('yes');
    await editor.submit();
    await expect(editor.successAlert).toContainText('Round was updated successfully');

    await editor.goto(roundId);
    await expect(editor.roundNameInput).toHaveValue(renamed);
    await expect(editor.silentTransferRadio('yes')).toBeChecked();

    const round = (await cfaAdmin.programRounds(program)).find((r) => r.id === roundId);
    expect(round).toMatchObject({ name: renamed, silentTransfer: '1' });
  });

  test('the round editor refuses an empty round name', async ({ adminPage, cfaAdmin }) => {
    const editor = new RoundEditorPage(adminPage);
    await editor.goto(roundId);
    const current = await editor.roundNameInput.inputValue();
    /* The field is data-parsley-required; remove the browser-side check to reach the server rule. */
    await editor.roundNameInput.evaluate((el) => el.removeAttribute('data-parsley-required'));
    await editor.roundNameInput.fill('');
    await editor.submit();
    await expect(editor.errorAlert).toContainText('Round name is required');
    expect((await cfaAdmin.programRounds(program)).find((r) => r.id === roundId)?.name).toBe(current);
  });

  test('a deleted round leaves the round list', async ({ cfaAdmin }) => {
    expect(await cfaAdmin.deleteRound(program, roundId)).toMatchObject({ error: false, success: true });
    const rounds = await cfaAdmin.programRounds(program);
    expect(rounds.map((r) => r.id)).not.toContain(roundId);
    /* The program's other round is untouched. */
    expect(rounds.map((r) => r.id)).toEqual(program.roundIds);
  });
});

test.describe('CFA P2: test mode', { tag: TAGS }, () => {
  let program: CfaProgram;

  test.beforeAll(async ({ cfaAdmin, cfaRun }) => {
    skipIfRunSkipped(cfaRun);
    program = await createCfaProgram(cfaAdmin, { runId: cfaRun.runId, label: 'p2-testmode', rounds: 0, ratingCriteriaOnLastRound: false });
  });

  test.afterAll(async ({ cfaAdmin }) => {
    if (program) await deleteCfaProgram(cfaAdmin, program.id);
  });

  test('test mode off shows the program live; back on hides it from /call-for-applications', { tag: '@frontend' }, async ({ adminPage, cfaAdmin, page }) => {
    /* No deadline on the throwaway, so turning test mode off never exposes a closed/past program. */
    const before = await cfaAdmin.programByCode(program.code);
    expect(before.data?.applicationClosedDate ?? null).toBeNull();

    const wizard = new ProgramWizardPage(adminPage);
    await wizard.gotoFinalize(program.id, program.adminSlug);
    await expect(wizard.testModeHeading).toBeVisible();

    /* Test mode off makes this [QA] program publicly listed, so the window is exactly one
       assertion and test mode is switched back on in `finally` whatever happens. */
    try {
      expect(await wizard.clickAndConfirm(wizard.disableTestModeButton, 'changeTestMode')).toMatchObject({ error: false, success: true });
      await expect(wizard.liveHeading).toBeVisible({ timeout: 15_000 });
    } finally {
      await cfaAdmin.submitAction(wizardPath(program), 'changeTestMode', { action: 'enable', programId: program.id });
    }

    await wizard.gotoFinalize(program.id, program.adminSlug);
    await expect(wizard.testModeHeading).toBeVisible();
    expect((await cfaAdmin.programByCode(program.code)).data?.testModeEnabled).toBe(true);

    const list = new CallForApplicationsPage(page);
    const response = await list.goto();
    expect(response.ok()).toBe(true);
    const programs: { uuid?: string }[] = (await response.json())?.data ?? [];
    expect(programs.map((p) => p.uuid)).not.toContain(program.uuid);
    await expect(list.programCard(program.title)).toHaveCount(0);
  });
});

test.describe('CFA P2: make a draft program live', { tag: TAGS }, () => {
  test('Go Live publishes the program and its form; the apply page renders by direct URL', { tag: '@frontend' }, async ({ adminPage, cfaAdmin, cfaRun, page }) => {
    test.setTimeout(120_000);
    const draft = await createBareCfaProgram(cfaAdmin, { runId: cfaRun.runId, label: `p2-golive-${rand()}` });
    try {
      await importTemplateFields(cfaAdmin, draft);
      await cfaAdmin.submitAction(wizardPath(draft), 'editProgram', editProgramForm({ title: draft.title, runId: cfaRun.runId }));

      const before = await programApplyInfo(cfaAdmin, draft);
      expect(before.backend.data?.status, 'draft program status').toBe(false);
      expect(before.backend.data?.form, 'draft program form (unpublished)').toBeUndefined();

      const wizard = new ProgramWizardPage(adminPage);
      await wizard.gotoFinalize(draft.id, draft.adminSlug);
      await expect(wizard.readyToGoLiveHeading).toBeVisible();

      /* Go Live on a program with test mode off would list a [QA] program publicly. The wizard
         only offers Go Live while the program is a draft (status 0), and switching test mode on
         first hides Go Live (changeTestMode enable also sets status 1). So test mode is switched
         on by the test in the instant before the Go Live request reaches the server: the click
         and its makeProgramLive POST are the real UI ones, and the program is never listed. */
      await adminPage.route(`**${wizardPath(draft, 'finalize')}`, async (route) => {
        if (route.request().method() === 'POST' && (route.request().postData() ?? '').includes('submitAction=makeProgramLive')) {
          await cfaAdmin.submitAction(wizardPath(draft), 'changeTestMode', { action: 'enable', programId: draft.id });
        }
        await route.continue();
      });
      expect(await wizard.clickAndConfirm(wizard.goLiveButton, 'makeProgramLive')).toMatchObject({ error: false, success: true });

      const after = await programApplyInfo(cfaAdmin, draft);
      expect(after.backend.data?.status, 'program status').toBe(true);
      expect(after.backend.data?.testModeEnabled, 'test mode').toBe(true);
      expect(after.backend.data?.form?.uuid, 'published form').toBeTruthy();

      await wizard.gotoFinalize(draft.id, draft.adminSlug);
      await expect(wizard.readyToGoLiveHeading).toHaveCount(0);
      await expect(wizard.testModeHeading).toBeVisible();

      const apply = new ProgramApplyPage(page);
      await apply.goto(after.code, after.slug);
      await expect(apply.programTitle(draft.title)).toBeVisible({ timeout: 20_000 });
    } finally {
      await deleteCfaProgram(cfaAdmin, draft.id);
    }
  });
});

/** Clicks a finalize-step button when this admin's role renders it, else posts the same submitAction. */
async function finalizeAction(
  wizard: ProgramWizardPage,
  admin: CfaAdmin,
  program: CfaProgram,
  button: Locator,
  action: string,
): Promise<'ui' | 'api'> {
  if (await button.isVisible()) {
    expect(await wizard.clickAndConfirm(button, action)).toMatchObject({ error: false, success: true });
    return 'ui';
  }
  expect(await admin.submitAction(wizardPath(program), action, { programId: program.id })).toMatchObject({ error: false, success: true });
  return 'api';
}

test.describe('CFA P2: close and reopen applications', { tag: TAGS }, () => {
  test.describe.configure({ mode: 'serial' });
  let program: CfaProgram;

  test.beforeAll(async ({ cfaAdmin, cfaRun }) => {
    skipIfRunSkipped(cfaRun);
    program = await createCfaProgram(cfaAdmin, { runId: cfaRun.runId, label: 'p2-close-apps', rounds: 0, ratingCriteriaOnLastRound: false });
  });

  test.afterAll(async ({ cfaAdmin }) => {
    if (program) await deleteCfaProgram(cfaAdmin, program.id);
  });

  test('closing applications shows them closed in the wizard and the program list', async ({ adminPage, cfaAdmin }) => {
    const wizard = new ProgramWizardPage(adminPage);
    await wizard.gotoFinalize(program.id, program.adminSlug);
    const via = await finalizeAction(wizard, cfaAdmin, program, wizard.closeApplicationsButton, 'closeProgramApplications');
    test.info().annotations.push({ type: 'close-applications', description: `via ${via} (the buttons render for developer/super-admin roles only)` });

    await wizard.gotoFinalize(program.id, program.adminSlug);
    if (via === 'ui') {
      await expect(wizard.reopenApplicationsButton).toBeVisible();
      await expect(wizard.closeApplicationsButton).toHaveCount(0);
    }
    expect((await cfaAdmin.listProgramsInTab('ongoingEvaluation', program.title)).map((p) => p.id)).toContain(program.id);
    expect((await cfaAdmin.listProgramsInTab('live', program.title)).map((p) => p.id)).not.toContain(program.id);
    expect((await cfaAdmin.programByCode(program.code)).data?.applicationsClosed).toBe(true);
  });

  test('reopening applications shows them open again', async ({ adminPage, cfaAdmin }) => {
    const wizard = new ProgramWizardPage(adminPage);
    await wizard.gotoFinalize(program.id, program.adminSlug);
    const via = await finalizeAction(wizard, cfaAdmin, program, wizard.reopenApplicationsButton, 'reopenProgramApplications');

    await wizard.gotoFinalize(program.id, program.adminSlug);
    if (via === 'ui') {
      await expect(wizard.closeApplicationsButton).toBeVisible();
      await expect(wizard.reopenApplicationsButton).toHaveCount(0);
    }
    expect((await cfaAdmin.listProgramsInTab('live', program.title)).map((p) => p.id)).toContain(program.id);
    expect((await cfaAdmin.listProgramsInTab('ongoingEvaluation', program.title)).map((p) => p.id)).not.toContain(program.id);
    expect((await cfaAdmin.programByCode(program.code)).data?.applicationsClosed).toBe(false);
  });

  test('close / reopen without a program id is refused', async ({ cfaAdmin }) => {
    for (const action of ['closeProgramApplications', 'reopenProgramApplications']) {
      await expect(cfaAdmin.submitAction(wizardPath(program), action, { programId: '' })).rejects.toThrow(
        new RegExp(`${action} failed: Program Id is required`),
      );
    }
  });
});

test.describe('CFA P2: close a program', { tag: TAGS }, () => {
  let program: CfaProgram;

  test.beforeAll(async ({ cfaAdmin, cfaRun }) => {
    skipIfRunSkipped(cfaRun);
    program = await createCfaProgram(cfaAdmin, { runId: cfaRun.runId, label: 'p2-close-program', rounds: 0, ratingCriteriaOnLastRound: false });
  });

  test.afterAll(async ({ cfaAdmin }) => {
    if (program) await deleteCfaProgram(cfaAdmin, program.id);
  });

  test('a closed program is listed under Closed in the program list', async ({ adminPage, cfaAdmin }) => {
    expect((await cfaAdmin.listProgramsInTab('closed', program.title)).map((p) => p.id)).not.toContain(program.id);

    const wizard = new ProgramWizardPage(adminPage);
    await wizard.gotoFinalize(program.id, program.adminSlug);
    const via = await finalizeAction(wizard, cfaAdmin, program, wizard.closeProgramButton, 'closeProgram');
    test.info().annotations.push({ type: 'close-program', description: `via ${via}` });

    expect((await cfaAdmin.listProgramsInTab('closed', program.title)).map((p) => p.id)).toContain(program.id);
    expect((await cfaAdmin.listProgramsInTab('live', program.title)).map((p) => p.id)).not.toContain(program.id);
    expect((await cfaAdmin.listProgramsInTab('ongoingEvaluation', program.title)).map((p) => p.id)).not.toContain(program.id);
    const backend = (await cfaAdmin.programByCode(program.code)).data;
    expect(backend?.programClosed).toBe(true);
    expect(backend?.applicationsClosed).toBe(true);
  });
});
