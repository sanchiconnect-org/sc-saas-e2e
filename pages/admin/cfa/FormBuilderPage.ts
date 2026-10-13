import { type Locator, type Page } from '@playwright/test';
import { type AdminJson } from '../../../fixtures/cfa';
import { confirmSwal, waitForSubmitAction } from './adminAjax';

/**
 * Form builder: {ADMIN_URL}/form-management/edit-form/{formId}/{slug}?programId={id}&applicationForms=1
 * (sc-saas-admin modules/form-management/edit-form.php, template
 * themes/default/html/form-management/edit-form.php).
 *
 * The whole builder is one HTML form; every field is a hidden input holding its JSON. Adding a
 * field and saving its settings each re-post the form as submitAction=saveForm. Field ordering
 * uses jQuery-UI sortable and is deliberately not driven here (FT-006: keep builder UI tests to two).
 */
export class FormBuilderPage {
  constructor(private readonly page: Page) {}

  async goto(path: string) {
    await this.page.goto(path, { waitUntil: 'domcontentloaded' });
    await this.sections.first().waitFor();
  }

  get sections(): Locator {
    return this.page.locator('#sectionsListBox .addFieldButton');
  }

  /** Field cards on the canvas, in order. */
  get fieldCards(): Locator {
    return this.page.locator('.sectionFields .columnField');
  }

  fieldCardTitled(name: string): Locator {
    return this.fieldCards.filter({ has: this.page.locator('b.fieldTitle', { hasText: name }) });
  }

  /** Field keys on the canvas, in order. */
  async fieldKeys(): Promise<string[]> {
    return this.fieldCards.evaluateAll((els) => els.map((e) => e.getAttribute('fieldKey') ?? ''));
  }

  /**
   * Adds a field to the first section: "+ Add field" → field type → title (and options for
   * select/radio/checkbox) → Save. Returns the saveForm JSON of the save that carries the title.
   *
   * The builder posts saveForm several times along the way, some of them concurrently and each
   * 500 ms after its trigger (opening the picker, picking the type, saving the field), so only
   * the save whose body holds the new title is the one that matters.
   */
  async addField(type: string, title: string, options: string[] = []): Promise<AdminJson> {
    await this.sections.first().click();
    const modal = this.page.locator('#addFieldModal');
    await modal.waitFor({ state: 'visible' });
    /* Picking the type adds a placeholder field and opens its settings panel. */
    await modal.locator(`.fieldTypeBox[fieldType="${type}"]`).click();
    await modal.waitFor({ state: 'hidden' });
    const titleInput = this.page.locator('#fieldTitle');
    await titleInput.waitFor({ state: 'visible' });

    await titleInput.fill(title);
    for (const [i, option] of options.entries()) {
      await this.page.locator('#addSelectOptionBtn').click();
      await this.page.locator('#selectBoxPropertiesBox #optionsList .optionBox input[type=text]').nth(i).fill(option);
    }
    const saved = waitForSubmitAction(this.page, 'saveForm', { bodyContains: title });
    await this.page.locator('#saveFieldDataBtn').first().click();
    return saved;
  }

  /** The Save button in the sticky header (submitAction=saveForm). */
  async save(): Promise<AdminJson> {
    const saved = waitForSubmitAction(this.page, 'saveForm');
    await this.page.locator('#submitFormBtn').click();
    return saved;
  }

  /**
   * Opens "Form Version History", restores the version with this spa_admin_logs id and waits
   * for the builder's own reload that follows a successful restore.
   */
  async restoreVersion(recordId: string): Promise<AdminJson> {
    await this.page.locator('#formVersionsBtn').click();
    const restore = this.page.locator(`#formVersionsContent .restoreFormBtn[recordId="${recordId}"]`);
    await restore.click();
    const restored = waitForSubmitAction(this.page, 'restoreForm');
    const reloaded = this.page.waitForEvent('domcontentloaded', { timeout: 30_000 });
    await confirmSwal(this.page);
    const json = await restored;
    if (json.success === true) {
      await reloaded;
      await this.sections.first().waitFor();
    }
    return json;
  }
}
