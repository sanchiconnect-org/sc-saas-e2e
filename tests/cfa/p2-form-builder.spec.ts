/**
 * CFA regression suite P2 (FT-006 / SAN-1880): the application form builder (admin).
 * Owner: Ritu Raj
 * Pass bar: fields added in the builder reach the PWA apply page; restoring an older version
 * brings back exactly that version's field set; importing the E2E template form copies all of
 * its fields. Each test uses its own throwaway program, deleted at the end.
 *
 * Only two tests drive the builder UI (FT-006: its jQuery-UI sortable and modals are flaky);
 * the import check goes through the same submitAction the "Copy fields" picker posts.
 * uploadFieldsJson is not tested: it is gated to is_dev admins.
 */
import { env } from '../../config/env';
import {
  cfaEmail,
  createBareCfaProgram,
  createCfaProgram,
  deleteCfaProgram,
  expect,
  formBuilderPath,
  importTemplateFields,
  test,
} from '../../fixtures/cfa';
import { FormBuilderPage } from '../../pages/admin/cfa/FormBuilderPage';
import { ProgramApplyPage } from '../../pages/frontend/cfa/ProgramApplyPage';

const rand = () => Math.random().toString(36).slice(2, 8);

test.describe('CFA P2: form builder', { tag: ['@regression', '@cfa', '@write', '@admin'] }, () => {
  test('fields added in the builder show on the PWA apply page', { tag: '@frontend' }, async ({ adminPage, cfaAdmin, cfaRun, page }) => {
    test.setTimeout(150_000);
    const program = await createCfaProgram(cfaAdmin, { runId: cfaRun.runId, label: `p2-fb-fields-${rand()}`, rounds: 0, ratingCriteriaOnLastRound: false });
    try {
      const tag = rand();
      const shortText = `QA short text ${tag}`;
      const dropdown = `QA dropdown ${tag}`;

      const builder = new FormBuilderPage(adminPage);
      await builder.goto(formBuilderPath(program));
      expect(await builder.addField('text_field', shortText)).toMatchObject({ error: false, success: true });
      expect(await builder.addField('selectbox_field', dropdown, ['QA Alpha', 'QA Beta'])).toMatchObject({ error: false, success: true });

      /* Read back what the server stored, not what the canvas shows. */
      const fields = await cfaAdmin.formFields(program.formId);
      expect(fields).toContainEqual(expect.objectContaining({ name: shortText, type: 'text_field' }));
      expect(fields).toContainEqual(expect.objectContaining({ name: dropdown, type: 'selectbox_field' }));

      /* The PWA opens straight on the form for a returning guest (see ProgramApplyPage.useGuestIdentity). */
      const apply = new ProgramApplyPage(page);
      await apply.useGuestIdentity(program.uuid, { email: cfaEmail(cfaRun.runId, `p2fb_${tag}`), name: `QA P2 ${tag}` });
      await apply.goto(program.code, program.slug);
      await expect(apply.applicationForm).toBeVisible({ timeout: 20_000 });
      await expect(apply.formFieldLabel(shortText)).toBeVisible();
      await expect(apply.formFieldLabel(dropdown)).toBeVisible();
    } finally {
      await deleteCfaProgram(cfaAdmin, program.id);
    }
  });

  test('restoring an earlier version brings back its field set', async ({ adminPage, cfaAdmin, cfaRun }) => {
    test.setTimeout(150_000);
    const program = await createCfaProgram(cfaAdmin, { runId: cfaRun.runId, label: `p2-fb-versions-${rand()}`, rounds: 0, ratingCriteriaOnLastRound: false });
    try {
      const builder = new FormBuilderPage(adminPage);
      await builder.goto(formBuilderPath(program));

      /* Version 1: the imported template fields, saved as they are. It is now the current
         version, so it has no Restore button yet. */
      expect(await builder.save()).toMatchObject({ error: false, success: true });
      const version1 = await cfaAdmin.formFields(program.formId);
      expect(version1.length, 'template fields on the program form').toBeGreaterThan(0);
      const restorableAtVersion1 = new Set(await cfaAdmin.formVersionIds(program.formId));

      /* Version 2: one more field. */
      const extra = `QA v2 field ${rand()}`;
      expect(await builder.addField('text_field', extra)).toMatchObject({ error: false, success: true });
      const version2 = await cfaAdmin.formFields(program.formId);
      expect(version2.map((f) => f.name)).toContain(extra);
      expect(version2).toHaveLength(version1.length + 1);

      /* Every save is a version row (spa_admin_logs). Adding the field saved several times, so
         version 1 is now restorable: the oldest row that was not restorable at version 1. */
      const added = (await cfaAdmin.formVersionIds(program.formId)).filter((id) => !restorableAtVersion1.has(id));
      expect(added.length, 'versions that became restorable after version 1').toBeGreaterThan(0);
      const version1Id = added.map(Number).sort((a, b) => a - b)[0].toString();

      await builder.goto(formBuilderPath(program));
      expect(await builder.restoreVersion(version1Id)).toMatchObject({ error: false, success: true });

      const restored = await cfaAdmin.formFields(program.formId);
      expect(restored.map((f) => [f.key, f.name, f.type])).toEqual(version1.map((f) => [f.key, f.name, f.type]));

      /* The builder reloaded after the restore; the extra field is gone from the canvas too. */
      await expect(builder.fieldCardTitled(extra)).toHaveCount(0);
      expect(await builder.fieldKeys()).toEqual(version1.map((f) => f.key));
    } finally {
      await deleteCfaProgram(cfaAdmin, program.id);
    }
  });

  test('importing the E2E template form copies all of its fields (importFieldsFromForm)', async ({ cfaAdmin, cfaRun }) => {
    const template = await cfaAdmin.formFields(env.cfa.templateFormId!);
    expect(template.length, 'fields on QA_CFA_TEMPLATE_FORM_ID').toBeGreaterThan(0);

    const program = await createBareCfaProgram(cfaAdmin, { runId: cfaRun.runId, label: `p2-fb-import-${rand()}` });
    try {
      expect(await cfaAdmin.formFields(program.formId), 'a new program form starts empty').toEqual([]);

      expect(await importTemplateFields(cfaAdmin, program)).toMatchObject({ error: false, success: true });

      const imported = await cfaAdmin.formFields(program.formId);
      expect(imported).toHaveLength(template.length);
      expect(imported.map((f) => [f.key, f.name, f.type])).toEqual(template.map((f) => [f.key, f.name, f.type]));
    } finally {
      await deleteCfaProgram(cfaAdmin, program.id);
    }
  });

  test('importFieldsFromForm without a source form is refused', async ({ cfaAdmin, cfaRun }) => {
    const program = await createBareCfaProgram(cfaAdmin, { runId: cfaRun.runId, label: `p2-fb-import-err-${rand()}` });
    try {
      await expect(
        cfaAdmin.submitAction(`/form-management/edit-form/${program.formId}/${program.formSlug}`, 'importFieldsFromForm', {
          formId: program.formId,
          selectedFormId: '',
        }),
      ).rejects.toThrow(/importFieldsFromForm failed: Form Id to be imported is required/);
      expect(await cfaAdmin.formFields(program.formId), 'form unchanged').toEqual([]);
    } finally {
      await deleteCfaProgram(cfaAdmin, program.id);
    }
  });
});
