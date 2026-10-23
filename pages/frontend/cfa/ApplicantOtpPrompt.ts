import { expect, type Locator, type Page, type Response } from '@playwright/test';

/**
 * The "Verify Your Email" prompt (SAN-1959): the check-status modal of the PWA apply page
 * (sc-saas-frontend program-check-status-modal, `verifyOnly` mode). The page opens it when a guest
 * call needs an applicant token the browser does not hold:
 *  - a stored guest identity without an unexpired token (any guest from before SAN-1959),
 *  - a returning guest on a bypass-OTP program whose first save is refused
 *    (401 APPLICANT_TOKEN_REQUIRED, only in APPLICANT_TOKEN_MODE=enforce),
 *  - the admin "view as applicant" link without a token in its fragment.
 * The email is pre-filled and locked. "Send OTP" posts otp_verifications/send, then "Submit" posts
 * /verify with applicantProgramUUID; the token from that response is stored and the modal closes.
 */
export class ApplicantOtpPrompt {
  readonly root: Locator;

  constructor(private readonly page: Page) {
    this.root = page.locator('app-program-check-status-modal').filter({ hasText: 'Verify Your Email' });
  }

  get actionButton(): Locator {
    return this.root.locator('.modal-body button.btn-theme');
  }

  get otpBoxes(): Locator {
    return this.root.locator('ng-otp-input input');
  }

  /**
   * Sends the OTP and verifies `otp` (ng-otp-input needs real key events, see GuestLeadModal.verifyOtp).
   * Returns the send and verify responses; the modal closes once the token is stored.
   */
  async verify(otp: string): Promise<{ sent: Response; verified: Response }> {
    await expect(this.root).toBeVisible({ timeout: 30_000 });
    await expect(this.actionButton).toHaveText(/send otp/i);
    const [sent] = await Promise.all([
      this.page.waitForResponse((r) => r.url().includes('otp_verifications/send') && r.request().method() === 'POST'),
      this.actionButton.click(),
    ]);
    expect(sent.status(), `otp_verifications/send: HTTP ${sent.status()}`).toBeLessThan(400);
    await expect(this.otpBoxes).toHaveCount(otp.length);
    await this.otpBoxes.first().click();
    await this.page.keyboard.type(otp, { delay: 50 });
    await expect(this.actionButton).toBeEnabled();
    const [verified] = await Promise.all([
      this.page.waitForResponse((r) => r.url().includes('otp_verifications/verify') && r.request().method() === 'POST'),
      this.actionButton.click(),
    ]);
    expect(verified.ok(), `otp_verifications/verify: HTTP ${verified.status()} ${await verified.text()}`).toBe(true);
    await expect(this.root).toBeHidden();
    return { sent, verified };
  }
}
