import { expect, type Page } from '@playwright/test';

/**
 * Profile edit screens for partner, service provider, individual and program office.
 * Paths and fields were taken from the development PWA on 22 Oct 2026.
 */
export class ProfileEditPage {
  constructor(private readonly page: Page) {}

  async expectField(path: string, selector: string) {
    await this.page.goto(path);
    await expect(this.page.locator(selector)).toBeVisible({ timeout: 20_000 });
  }

  /**
   * Opens My Profile. The link sits in a closed user menu, so the test follows its href
   * instead of requiring the dropdown to be open.
   */
  async openPublicProfile(hrefPart: string) {
    const link = this.page.locator(`a[href*="${hrefPart}"]`, { hasText: 'My Profile' });
    await expect(link).toHaveCount(1);
    const href = await link.getAttribute('href');
    if (!href) throw new Error(`My Profile link for ${hrefPart} has no href`);
    await this.page.goto(href);
    await expect(this.page).toHaveURL(new RegExp(hrefPart.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    await expect(this.page).not.toHaveURL(/\/auth\/login/);
  }
}
