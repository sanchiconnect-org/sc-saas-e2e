import { expect, type Locator, type Page, type Response } from '@playwright/test';

/**
 * Investor investments details — /investors/edit/investments-details
 *
 * Auto-save (SAN-508) only PATCHes when instruments + stages are selected and
 * ticket size is valid; Next Step needs the full required set. Prefer filling
 * one option in each required group, then assert the PATCH.
 */
export class InvestorProfilePage {
  readonly turnaroundTime: Locator;
  readonly ticketSizeMin: Locator;
  readonly ticketSizeMax: Locator;

  constructor(private readonly page: Page) {
    this.turnaroundTime = page.locator('input[formcontrolname=turnAroundTime]');
    this.ticketSizeMin = page.locator('input[formcontrolname=ticketSizeMin]');
    this.ticketSizeMax = page.locator('input[formcontrolname=ticketSizeMax]');
  }

  async goto() {
    await this.page.goto('/investors/edit/investments-details');
    await expect(this.turnaroundTime).toBeVisible({ timeout: 20_000 });
  }

  private async ensureCheckbox(id: string) {
    const box = this.page.locator(`input#${id}`);
    if (!(await box.count())) return;
    if (await box.isChecked()) return;
    const label = this.page.locator(`label[for="${id}"]`);
    if (await label.count()) await label.click();
    else await box.evaluate((el: HTMLInputElement) => el.click());
  }

  private async ensureLabel(text: string) {
    const label = this.page.locator('label').filter({ hasText: new RegExp(`^\\s*${text}\\s*$`) }).first();
    if (!(await label.count())) return;
    const forId = await label.getAttribute('for');
    if (forId) {
      const box = this.page.locator(`input#${forId}`);
      if (await box.count()) {
        if (await box.isChecked()) return;
        await label.click();
        return;
      }
    }
    await label.click();
  }

  /** One selection in each required group + unique TAT so auto-save / Next can persist. */
  async ensureBasics(tat: string) {
    await this.ensureCheckbox('model1');
    await this.ensureCheckbox('pref1');
    await this.ensureCheckbox('stage1');
    for (const text of ['B2B', 'Team', 'Aerospace']) {
      await this.ensureLabel(text);
    }
    if ((await this.ticketSizeMin.inputValue()).replace(/,/g, '') === '') {
      await this.ticketSizeMin.fill('5000');
    }
    if ((await this.ticketSizeMax.inputValue()).replace(/,/g, '') === '') {
      await this.ticketSizeMax.fill('100000000');
    }
    await this.turnaroundTime.fill(tat);
    await this.turnaroundTime.blur();
  }

  waitForSave(): Promise<Response> {
    return this.page.waitForResponse(
      (r) =>
        r.url().includes('/investors/investments-information') &&
        r.request().method() === 'PATCH' &&
        r.ok(),
      { timeout: 45_000 },
    );
  }
}
