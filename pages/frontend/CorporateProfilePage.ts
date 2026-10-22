import { expect, type Locator, type Page, type Response } from '@playwright/test';

/**
 * Corporate intro — /corporates/edit/corporate-intro
 */
export class CorporateProfilePage {
  readonly companyName: Locator;
  readonly about: Locator;
  readonly country: Locator;
  readonly state: Locator;
  readonly city: Locator;
  readonly logoInput: Locator;
  readonly sizeRadios: Locator;

  constructor(private readonly page: Page) {
    this.companyName = page.locator('input#startupName');
    this.about = page.locator('.ql-editor');
    this.country = page.locator('ng-select#registeredCountryId');
    this.state = page.locator('ng-select#registeredStateId');
    this.city = page.locator('ng-select#registeredCityId');
    this.logoInput = page.locator('input[type=file][name=avatar]');
    this.sizeRadios = page.locator('input[formcontrolname=size]');
  }

  async goto() {
    await this.page.goto('/corporates/edit/corporate-intro');
    await expect(this.companyName).toBeVisible({ timeout: 20_000 });
  }

  async pickNgSelect(select: Locator, label: string) {
    if ((await select.locator('.ng-value').count()) > 0) return;
    await select.click();
    const option = this.page.locator('ng-dropdown-panel .ng-option:not(.ng-option-disabled)').first();
    await expect(option, `no ${label} options`).toBeVisible({ timeout: 15_000 });
    await option.click();
    await expect(select.locator('.ng-value'), `${label} not selected`).toHaveCount(1);
  }

  async ensureCompanySize() {
    if (await this.sizeRadios.first().isChecked()) return;
    /* Click the form-check card — Angular radios ignore locator.check(). */
    const wrap = this.sizeRadios.first().locator('xpath=ancestor::*[contains(@class,"form-check")][1]');
    await wrap.click({ force: true });
    await expect(this.sizeRadios.first()).toBeChecked({ timeout: 5_000 });
  }

  async uploadLogo(file: { name: string; mimeType: string; buffer: Buffer }) {
    if (!(await this.logoInput.count())) return;
    /* Already has a real logo — don't re-open crop (can leave the form invalid). */
    const existing = this.page.locator('.image-input img, [data-kt-image-input] img').first();
    if ((await existing.count()) && /imagekit|corporates\/.*\/logo/i.test((await existing.getAttribute('src')) || '')) {
      return;
    }
    await this.logoInput.setInputFiles(file);
    const preview = this.page.locator('ngb-modal-window').filter({ hasText: 'Avatar Preview' });
    await expect(preview).toBeVisible({ timeout: 10_000 });
    const uploaded = this.page.waitForResponse(
      (r) => r.url().includes('/corporates/upload/logo') && r.request().method() === 'POST' && r.ok(),
      { timeout: 30_000 },
    );
    await preview.getByRole('button', { name: /^save$/i }).click();
    expect((await uploaded).ok()).toBe(true);
    await expect(preview).toBeHidden({ timeout: 20_000 });
    await expect(existing).toHaveAttribute('src', /logo|imagekit/i, { timeout: 15_000 });
  }

  waitForSave(): Promise<Response> {
    return this.page.waitForResponse(
      (r) =>
        r.url().includes('/corporates/corporate-information') &&
        r.request().method() === 'PATCH' &&
        r.ok(),
      { timeout: 45_000 },
    );
  }
}
