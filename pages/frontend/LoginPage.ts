import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Member PWA login — /auth/login (sc-saas-frontend/src/app/modules/auth/pages/login/).
 * Step 1 asks for an email (shown only when the tenant has email_otp_verification on);
 * step 2 is a 4-box ng-otp-input.
 */
export class LoginPage {
  readonly title: Locator;
  readonly emailInput: Locator;
  readonly continueButton: Locator;
  readonly otpTitle: Locator;
  readonly otpBoxes: Locator;
  readonly otpSubmitButton: Locator;

  constructor(private readonly page: Page) {
    this.title = page.getByTestId('login-title');
    this.emailInput = page.locator('input#email');
    this.continueButton = page.getByTestId('email-continue-btn');
    this.otpTitle = page.getByTestId('verify-otp-title');
    this.otpBoxes = page.locator('ng-otp-input input');
    this.otpSubmitButton = page.getByTestId('otp-continue-btn');
  }

  async goto() {
    await this.page.goto('/auth/login');
    await expect(this.title).toBeVisible();
  }

  async requestOtp(email: string) {
    await this.emailInput.fill(email);
    await this.continueButton.click();
    await expect(this.otpTitle).toBeVisible();
  }

  async enterOtp(otp: string) {
    await expect(this.otpBoxes).toHaveCount(otp.length);
    for (let i = 0; i < otp.length; i++) {
      await this.otpBoxes.nth(i).fill(otp[i]);
    }
    await this.otpSubmitButton.click();
  }

  async loginWithEmail(email: string, otp: string) {
    await this.goto();
    await this.requestOtp(email);
    await this.enterOtp(otp);
  }
}

/** Where the login effect sends each role (sc-saas-frontend/src/app/core/state/auth/auth.effect.ts). */
export const dashboardPathFor = (role: string) =>
  role === 'startup' ? /\/startups\/dashboard/ : /\/investors\/dashboard/;
