import { type Locator, type Page } from '@playwright/test';
import { type AdminJson } from '../../../fixtures/cfa';
import { confirmSwal, waitForSubmitAction } from './adminAjax';

/**
 * Admin program wizard: {ADMIN_URL}/application_management/program/{id}/{step}/{slug}, where step is
 * edit | application_form | finalize (sc-saas-admin modules/application_management/program.php,
 * template themes/default/html/application_management/program.php).
 * Every button here posts a submitAction to the same URL; the page reloads after a success.
 */
export class ProgramWizardPage {
  constructor(private readonly page: Page) {}

  async gotoEdit(programId: string, slug: string) {
    await this.page.goto(`/application_management/program/${programId}/edit/${slug}`, { waitUntil: 'domcontentloaded' });
  }

  async gotoFinalize(programId: string, slug: string) {
    await this.page.goto(`/application_management/program/${programId}/finalize/${slug}`, { waitUntil: 'domcontentloaded' });
  }

  /* ----- edit step: basic details (editProgram) ----- */

  get titleInput(): Locator {
    return this.page.locator('#program_title');
  }

  get shortDescriptionInput(): Locator {
    return this.page.locator('#short_description');
  }

  get displayOrderInput(): Locator {
    return this.page.locator('#display_order');
  }

  /**
   * "Save & continue" at the bottom of the edit step; returns the editProgram JSON. On success
   * the wizard moves on to its editUrl (the application_form step) by itself; this waits for it.
   */
  async saveBasicDetails(): Promise<AdminJson> {
    return this.saveAndFollow('editProgram', this.page.locator('#submitFormBtnBottom'));
  }

  /* ----- finalize step: state headings and buttons ----- */

  /** Draft program (status 0): "Your program is ready to go live!" with a Go Live button. */
  get readyToGoLiveHeading(): Locator {
    return this.page.getByRole('heading', { name: /ready to go live/ });
  }

  get goLiveButton(): Locator {
    return this.page.locator('#makeProgramLiveBtn');
  }

  /** Live program with test mode off: "Your program is live". */
  get liveHeading(): Locator {
    return this.page.getByRole('heading', { name: /^Your\s+program\s+is live$/ });
  }

  /** Live program in test mode: "Your program is in test mode". */
  get testModeHeading(): Locator {
    return this.page.getByRole('heading', { name: /is in test mode/ });
  }

  /** Shown on a live program in test mode; the Enable button replaces it when test mode is off. */
  get disableTestModeButton(): Locator {
    return this.page.locator('button.testModeBtn[action="disable"]');
  }

  get enableTestModeButton(): Locator {
    return this.page.locator('button.testModeBtn[action="enable"]');
  }

  /** Close / Re-open Applications and Close Program: rendered for developer and super-admin roles only. */
  get closeApplicationsButton(): Locator {
    return this.page.locator('#closeApplicationsBtn');
  }

  get reopenApplicationsButton(): Locator {
    return this.page.locator('#reopenApplicationsBtn');
  }

  get closeProgramButton(): Locator {
    return this.page.locator('#closeProgramBtn');
  }

  /**
   * Clicks a finalize-step button, confirms its SweetAlert prompt and returns the submitAction
   * JSON. On success the wizard reloads itself (after 0.5-1 s); this waits for that reload so
   * the next navigation doesn't collide with it.
   */
  async clickAndConfirm(button: Locator, action: string): Promise<AdminJson> {
    await button.click();
    const done = waitForSubmitAction(this.page, action);
    const reloaded = this.page.waitForEvent('domcontentloaded', { timeout: 30_000 });
    await confirmSwal(this.page);
    const json = await done;
    if (json.success === true) await reloaded;
    return json;
  }

  /* ----- finalize step: Evaluation Settings (editEvaluation) ----- */

  /** The checkbox behind an Evaluation Settings switch, e.g. auto_communication, editable_jury_ratings. */
  evaluationSwitch(id: string): Locator {
    return this.page.locator(`#formSection input#${id}`);
  }

  /** Flips an Evaluation Settings switch the way an admin does: a click on its slider. */
  async toggleEvaluationSwitch(id: string) {
    await this.page.locator(`#formSection label.switch:has(input#${id}) .slider`).click();
  }

  /** Saves Evaluation Settings; on success the wizard reloads the finalize step by itself, which this waits for. */
  async saveEvaluation(): Promise<AdminJson> {
    return this.saveAndFollow('editEvaluation', this.page.locator('#submitEvaluationBtn'));
  }

  private async saveAndFollow(action: string, button: Locator): Promise<AdminJson> {
    const saved = waitForSubmitAction(this.page, action);
    const navigated = this.page.waitForEvent('domcontentloaded', { timeout: 30_000 });
    await button.click();
    const json = await saved;
    if (json.success === true) await navigated;
    return json;
  }
}
