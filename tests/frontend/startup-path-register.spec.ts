/**
 * Startup regression path, journey 1 of 5 (SAN-1606): a new startup registers.
 * Owner: Ritu Raj
 * Pass bar: the email OTP verifies, POST /public/auth/register returns 2xx, the new startup
 * lands in its startup area, and its profile already holds the company name it registered with.
 *
 * Registration needs a user that doesn't exist yet, so this is the one journey of the path that
 * can't use the seeded startup: each run registers a NEW address from QA_REGISTER_EMAIL_PATTERN
 * (the QA backend lists the same pattern in QA_FIXED_OTP_EMAILS, SAN-1877). Created users build
 * up until the nightly reset (SAN-1613).
 */
import { expect, test } from '@playwright/test';
import { qaOtp } from '../../config/accounts';
import { RegisterPage } from '../../pages/frontend/RegisterPage';
import { StartupProfilePage } from '../../pages/frontend/StartupProfilePage';

const pattern = process.env.QA_REGISTER_EMAIL_PATTERN;

test.describe('startup path: register', { tag: ['@regression', '@frontend', '@startup', '@write'] }, () => {
  test.skip(!pattern || !pattern.includes('*'), 'QA_REGISTER_EMAIL_PATTERN not set (e.g. sc_reg_*@yopmail.com)');

  test('a new startup registers with email OTP and its profile holds the registered company name', async ({ page }) => {
    const runId = Date.now().toString();
    /* Lowercase, no "+": the register form's email regex rejects both. */
    const email = pattern!.replace('*', runId).toLowerCase();
    const companyName = `QA Path Startup ${runId}`;

    await page.addInitScript(() => window.localStorage.setItem('skip-first-login-modal', 'true'));

    const register = new RegisterPage(page);
    await register.goto();
    await register.chooseAccountType('startup');
    await register.fillProfile({ companyName, name: 'QA Path Founder', email });

    const verified = page.waitForResponse((r) => r.url().includes('/public/otp_verifications/verify') && r.request().method() === 'POST');
    const registered = page.waitForResponse((r) => r.url().includes('/public/auth/register') && r.request().method() === 'POST', {
      timeout: 60_000,
    });
    await register.enterOtp(qaOtp());

    const otpCheck = await verified;
    expect(otpCheck.ok(), `OTP rejected (${otpCheck.status()}) for ${email}: is "${pattern}" in the QA backend's QA_FIXED_OTP_EMAILS?`).toBe(true);
    const response = await registered;
    expect(response.ok(), `register returned ${response.status()} for ${email}`).toBe(true);
    await expect(page).toHaveURL(/\/startups\/(dashboard|edit\/startup-information)/);

    const profile = new StartupProfilePage(page);
    await profile.goto();
    await expect(profile.companyName).toHaveValue(companyName);
  });
});
