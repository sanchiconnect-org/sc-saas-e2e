import { expect, type Locator, type Page, type Response } from '@playwright/test';

/**
 * Startup profile, Basic Information — /startups/edit/startup-information
 * (sc-saas-frontend modules/startups/pages/edit/startup-information/).
 * No data-testid on this page yet; ids are the stable hooks.
 */
export class StartupProfilePage {
  readonly companyName: Locator;

  constructor(private readonly page: Page) {
    this.companyName = page.locator('input#companyName');
  }

  async goto() {
    await this.page.goto('/startups/edit/startup-information');
    /* The form is filled asynchronously from GET /startups/startup-information. */
    await expect(this.companyName).not.toHaveValue('');
  }

  /**
   * Resolves on the auto-save PATCH (debounced ~800ms after the last keystroke).
   * The "Changes saved automatically" toast fires before the request completes,
   * so the response, not the toast, is the proof of a save.
   */
  waitForStartupInfoSave(): Promise<Response> {
    return this.page.waitForResponse(
      (r) => r.url().includes('/startups/startup-information') && r.request().method() === 'PATCH',
      { timeout: 20_000 },
    );
  }
}
