/**
 * Journey: member logs in with an email OTP.
 * Owner: Ritu Raj
 * Pass bar: lands on the role's dashboard within the default timeouts.
 */
import { expect, test } from '@playwright/test';
import { memberAccount, qaOtp } from '../../config/accounts';
import { LoginPage, dashboardPathFor } from '../../pages/frontend/LoginPage';

test.describe('login with OTP', { tag: ['@smoke', '@frontend', '@startup'] }, () => {
  test('a startup logs in with email OTP and reaches the dashboard', async ({ page }) => {
    const account = memberAccount('startup');
    test.skip(!account, 'QA_STARTUP_EMAIL not set');

    const login = new LoginPage(page);
    await login.loginWithEmail(account!.email, qaOtp());

    await expect(page).toHaveURL(dashboardPathFor('startup'));
  });

  test('a wrong OTP is rejected and the user stays on the OTP step', async ({ page }) => {
    const account = memberAccount('startup');
    test.skip(!account, 'QA_STARTUP_EMAIL not set');

    const login = new LoginPage(page);
    await login.goto();
    await login.requestOtp(account!.email);
    const wrong = qaOtp() === '0000' ? '1111' : '0000';
    await login.enterOtp(wrong);

    await expect(login.otpTitle).toBeVisible();
    await expect(page).not.toHaveURL(dashboardPathFor('startup'));
  });
});
