import { expect, type Locator, type Page } from '@playwright/test';

/** Admin panel login — {ADMIN_URL}/auth/login (sc-saas-admin/themes/default/html/auth/login.php). */
export class AdminLoginPage {
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly signInButton: Locator;

  constructor(private readonly page: Page) {
    this.emailInput = page.locator('#inputEmail');
    this.passwordInput = page.locator('#inputPassword');
    this.signInButton = page.getByRole('button', { name: 'Sign in' });
  }

  async goto() {
    await this.page.goto('/auth/login');
    await expect(this.emailInput).toBeVisible();
  }

  async login(email: string, password: string) {
    await this.goto();
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.signInButton.click();
    await expect(this.page).not.toHaveURL(/\/auth\/login/);
  }
}
