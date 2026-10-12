/**
 * Journey 2 (SAN-1576): a new startup registers through the wizard.
 * Owner: Ritu Raj
 * Pass bar: POST /public/auth/register returns 2xx and the new startup lands in its
 * startup area (dashboard or profile edit, depending on tenant flags).
 *
 * Each run registers a NEW address built from QA_REGISTER_EMAIL_PATTERN
 * (e.g. sc_reg_*@yopmail.com). The QA backend must list the same pattern in
 * QA_FIXED_OTP_EMAILS (SAN-1877) so the OTP is known; skipped until configured.
 * Created users accumulate until the nightly reset (SAN-1613) cleans them up.
 */
import { expect, test } from '@playwright/test';
import { qaOtp } from '../../config/accounts';
import { RegisterPage } from '../../pages/frontend/RegisterPage';

const pattern = process.env.QA_REGISTER_EMAIL_PATTERN;

test.describe('register as a startup', { tag: ['@smoke', '@frontend', '@startup', '@write'] }, () => {
  test.skip(!pattern || !pattern.includes('*'), 'QA_REGISTER_EMAIL_PATTERN not set (e.g. sc_reg_*@yopmail.com)');

  test('a new startup completes registration with email OTP', async ({ page }) => {
    const runId = Date.now().toString();
    /* Lowercase, no "+": the register form's email regex rejects both. */
    const email = pattern!.replace('*', runId).toLowerCase();

    /* Skip the first-login profile modal on the dashboard (startup_onboarding_modal). */
    await page.addInitScript(() => window.localStorage.setItem('skip-first-login-modal', 'true'));

    const register = new RegisterPage(page);
    await register.goto();
    await register.chooseAccountType('startup');
    await register.fillProfile({ companyName: `QA Reg Startup ${runId}`, name: 'QA Reg Founder', email });

    const verified = page.waitForResponse(
      (r) => r.url().includes('/public/otp_verifications/verify') && r.request().method() === 'POST',
    );
    const registered = page.waitForResponse(
      (r) => r.url().includes('/public/auth/register') && r.request().method() === 'POST',
      { timeout: 60_000 },
    );
    await register.enterOtp(qaOtp());

    const otpCheck = await verified;
    expect(
      otpCheck.ok(),
      `OTP rejected (${otpCheck.status()}) for ${email}: is "${pattern}" in the QA backend's QA_FIXED_OTP_EMAILS, and is SAN-1877 deployed?`,
    ).toBe(true);
    const response = await registered;
    expect(response.ok(), `register returned ${response.status()} for ${email}`).toBe(true);
    await expect(page).toHaveURL(/\/startups\/(dashboard|edit\/startup-information)/);
  });
});
