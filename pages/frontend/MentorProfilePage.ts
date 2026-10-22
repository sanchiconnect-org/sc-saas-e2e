import { expect, type Locator, type Page, type Response } from '@playwright/test';

/**
 * Mentor profile — /mentors/edit/mentor-information
 */
export class MentorProfilePage {
  readonly name: Locator;
  readonly headline: Locator;
  readonly about: Locator;
  readonly country: Locator;
  readonly state: Locator;
  readonly city: Locator;
  readonly logoInput: Locator;

  constructor(private readonly page: Page) {
    this.name = page.locator('input#startupName');
    this.headline = page.locator('textarea[formcontrolname=shortDescription]');
    this.about = page.locator('.ql-editor');
    this.country = page.locator('ng-select#registeredCountryId');
    this.state = page.locator('ng-select#registeredStateId');
    this.city = page.locator('ng-select#registeredCityId');
    this.logoInput = page.locator('input[type=file][name=avatar]');
  }

  async goto() {
    await this.page.goto('/mentors/edit/mentor-information');
    await expect(this.name).toBeVisible({ timeout: 20_000 });
  }

  async pickNgSelect(select: Locator, label: string) {
    if ((await select.locator('.ng-value').count()) > 0) return;
    await select.click();
    const option = this.page.locator('ng-dropdown-panel .ng-option:not(.ng-option-disabled)').first();
    await expect(option, `no ${label} options`).toBeVisible({ timeout: 15_000 });
    await option.click();
    await expect(select.locator('.ng-value'), `${label} not selected`).toHaveCount(1);
  }

  waitForSave(): Promise<Response> {
    return this.page.waitForResponse(
      (r) =>
        r.url().includes('/mentors/') &&
        (r.request().method() === 'PATCH' || r.request().method() === 'POST') &&
        r.ok(),
      { timeout: 30_000 },
    );
  }
}
