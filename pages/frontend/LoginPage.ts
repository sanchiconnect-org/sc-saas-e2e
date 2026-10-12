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
    let status = await this.clickContinue();
    /* POST public/auth/mobile/login is rate-limited to 10 requests a minute, and one
       full run already makes ~10 logins — on a 429, wait the window out and retry once. */
    if (status === 429) {
      await this.page.waitForTimeout(61_000);
      status = await this.clickContinue();
    }
    expect(status, `login request for ${email} failed`).toBeLessThan(400);
    await expect(this.otpTitle).toBeVisible();
  }

  private async clickContinue(): Promise<number> {
    const [response] = await Promise.all([
      this.page.waitForResponse(
        (r) => r.url().includes('/public/auth/mobile/login') && r.request().method() === 'POST',
      ),
      this.continueButton.click(),
    ]);
    return response.status();
  }

  async enterOtp(otp: string) {
    await expect(this.otpBoxes).toHaveCount(otp.length);
    /* ng-otp-input only emits onInputChange (which enables Submit) on real key
       events and moves focus box-to-box itself — fill() sets the values but
       leaves Submit disabled. So type the digits from the first box. */
    await this.otpBoxes.first().click();
    await this.page.keyboard.type(otp, { delay: 50 });
    await this.otpSubmitButton.click();
  }

  async loginWithEmail(email: string, otp: string) {
    await this.goto();
    await this.requestOtp(email);
    await this.enterOtp(otp);
  }
}

/** Where each role lands after login — observed on development (thub.sanchidev.in), 12 Oct 2026. */
const DASHBOARD_PATH: Record<string, RegExp> = {
  startup: /\/startups\/dashboard/,
  investor: /\/investors\/dashboard/,
  corporate: /\/corporates\/dashboard/,
  mentor: /\/mentors\/dashboard/,
  partner: /\/partners\/dashboard/,
  service_provider: /\/service-provider\/dashboard/,
  individual: /\/individuals\/dashboard/,
  program_office: /\/program-office-members\/dashboard/,
};

export const dashboardPathFor = (role: string): RegExp => {
  const path = DASHBOARD_PATH[role];
  if (!path) throw new Error(`No dashboard path known for role "${role}"`);
  return path;
};
