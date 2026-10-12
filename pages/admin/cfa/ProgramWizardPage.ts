import { type Locator, type Page } from '@playwright/test';

/**
 * Admin program wizard: {ADMIN_URL}/application_management/program/{id}/{step}/{slug}, where step is
 * edit | application_form | finalize (sc-saas-admin modules/application_management/program.php).
 */
export class ProgramWizardPage {
  constructor(private readonly page: Page) {}

  async gotoFinalize(programId: string, slug: string) {
    await this.page.goto(`/application_management/program/${programId}/finalize/${slug}`);
  }

  /** Finalize step of a live program in test mode: "Your program is in test mode". */
  get testModeHeading(): Locator {
    return this.page.getByRole('heading', { name: /is in test mode/ });
  }

  /** Shown on a live program in test mode; the Enable button replaces it when test mode is off. */
  get disableTestModeButton(): Locator {
    return this.page.locator('button.testModeBtn[action="disable"]');
  }
}
