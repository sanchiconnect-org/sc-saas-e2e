import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Member registration wizard — /auth/register
 * (sc-saas-frontend modules/auth/pages/register/, one form#kt_create_account_form
 * stepped by stepCount). No data-testid here yet: ids, names and text are the hooks.
 */
export class RegisterPage {
  readonly continueButton: Locator;
  readonly companyName: Locator;
  readonly name: Locator;
  readonly email: Locator;
  readonly terms: Locator;
  readonly otpBoxes: Locator;

  constructor(private readonly page: Page) {
    /* Shared by every step; disabled while the step is invalid or loading. */
    this.continueButton = page.locator('button.next-button');
    this.companyName = page.locator('input#companyName');
    this.name = page.locator('input#name');
    this.email = page.locator('input#email');
    this.terms = page.locator('input#termsAndCondition');
    this.otpBoxes = page.locator('ng-otp-input#otp-input input');
  }

  async goto() {
    /* On phones the PWA's "Install App" banner (app.component.html, .pwa-install-banner) sits over
       the Continue button until dismissed; start as a user who has already dismissed it (SAN-1620). */
    await this.page.addInitScript(() => window.localStorage.setItem('pwa_install_dismissed', 'true'));
    await this.page.goto('/auth/register');
  }

  /** Step 0: account type card. */
  async chooseAccountType(type: string) {
    await this.page.locator(`input[type=radio][name=userType][value=${type}]`).check({ force: true });
    await expect(this.continueButton).toBeEnabled();
    await this.continueButton.click();
  }

  /** Step 1: Create Profile. The email is checked for duplicates ~1s after typing. */
  async fillProfile(p: { companyName: string; name: string; email: string }) {
    await this.companyName.fill(p.companyName);
    await this.name.fill(p.name);
    const emailChecked = this.page.waitForResponse((r) => r.url().includes('/public/auth/verify/email/'));
    await this.email.fill(p.email);
    await emailChecked;
    await this.terms.check({ force: true });
    await expect(this.continueButton).toBeEnabled();
    /* The OTP boxes appear immediately, but the wizard sends the email OTP ~1s later
       (register.component.ts sendOTP('email') after 1000ms). Verifying before that
       send lands returns 404 VERIFICATION_NOT_FOUND, so wait for the send. */
    /* Wizard delays sendOTP ~1s after Continue; allow headroom for slow QA tenants. */
    const otpSent = this.page.waitForResponse(
      (r) =>
        r.url().includes('/public/otp_verifications/send') &&
        r.request().method() === 'POST' &&
        (r.request().postDataJSON()?.type ?? '') === 'email',
      { timeout: 30_000 },
    );
    await this.continueButton.click();
    const sent = await otpSent;
    expect(sent.ok(), `email OTP send returned ${sent.status()}`).toBe(true);
  }

  /** Email OTP step: 4-box ng-otp-input that only reacts to real key events. */
  async enterOtp(otp: string) {
    await expect(this.otpBoxes).toHaveCount(otp.length);
    await this.otpBoxes.first().click();
    await this.page.keyboard.type(otp, { delay: 50 });
    await expect(this.continueButton).toBeEnabled();
    await this.continueButton.click();
  }
}
