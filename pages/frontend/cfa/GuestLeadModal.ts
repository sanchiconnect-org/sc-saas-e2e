import { expect, type Locator, type Page, type Response } from '@playwright/test';

/**
 * The "Apply" modal the PWA apply page opens on Apply (sc-saas-frontend
 * modules/programs/program-public-apply/program-public-apply-modal). It collects the applicant's
 * name and email (plus company / mobile when the program asks), upserts a lead
 * (POST public/application-program-leads/upsert) as they type, and then:
 *  - OTP required: "Send Otp" posts otp_verifications/send, the 4-box OTP appears, and
 *    "Submit" posts otp_verifications/verify;
 *  - bypass_otp_verification on, or a logged-in member: there is no OTP step, the button
 *    reads "Submit" from the start.
 * On Submit it writes the identity to localStorage['application-{programUuid}'] and closes;
 * no user or session is created for a guest.
 */
export class GuestLeadModal {
  readonly root: Locator;

  constructor(private readonly page: Page) {
    this.root = page.locator('app-program-public-apply-modal');
  }

  get nameInput(): Locator {
    return this.root.locator('input#name');
  }

  get emailInput(): Locator {
    return this.root.locator('input#email');
  }

  /** "Send Otp" before the OTP is sent, "Submit" after (or from the start when there is no OTP step). */
  get actionButton(): Locator {
    return this.root.locator('.modal-body button.btn-theme');
  }

  get otpBoxes(): Locator {
    return this.root.locator('ng-otp-input input');
  }

  /** Fills name and email and waits for the lead upsert that carries the email (debounced ~1.5s). */
  async fillApplicant(applicant: { name: string; email: string }): Promise<Response> {
    await expect(this.root).toBeVisible();
    const lead = this.page.waitForResponse(
      (r) =>
        r.url().includes('/application-program-leads/upsert') &&
        r.request().method() === 'POST' &&
        (r.request().postData() ?? '').includes(applicant.email),
    );
    await this.nameInput.fill(applicant.name);
    await this.emailInput.fill(applicant.email);
    await this.emailInput.blur();
    return lead;
  }

  /** Clicks "Send Otp" and returns the otp_verifications/send response. */
  async sendOtp(): Promise<Response> {
    await expect(this.actionButton).toHaveText(/send otp/i);
    const [response] = await Promise.all([
      this.page.waitForResponse((r) => r.url().includes('otp_verifications/send') && r.request().method() === 'POST'),
      this.actionButton.click(),
    ]);
    return response;
  }

  /**
   * Types the OTP (ng-otp-input only reacts to real key events, see LoginPage.enterOtp), clicks
   * Submit and returns the otp_verifications/verify response. The modal closes on success.
   */
  async verifyOtp(otp: string): Promise<Response> {
    await expect(this.otpBoxes).toHaveCount(otp.length);
    await this.otpBoxes.first().click();
    await this.page.keyboard.type(otp, { delay: 50 });
    await expect(this.actionButton).toBeEnabled();
    const [response] = await Promise.all([
      this.page.waitForResponse((r) => r.url().includes('otp_verifications/verify') && r.request().method() === 'POST'),
      this.actionButton.click(),
    ]);
    return response;
  }

  /** Submit when the modal has no OTP step (bypass on, or logged in). The modal closes. */
  async submitWithoutOtp() {
    await expect(this.actionButton).toHaveText(/submit/i);
    await expect(this.otpBoxes).toHaveCount(0);
    await this.actionButton.click();
    await expect(this.root).toBeHidden();
  }
}
