/**
 * Journey: admin and jury log in to the admin panel.
 * Owner: Ritu Raj
 */
import { expect, test } from '@playwright/test';
import { adminAccount } from '../../config/accounts';
import { AdminLoginPage } from '../../pages/admin/AdminLoginPage';

test.describe('admin panel login', { tag: ['@smoke', '@admin'] }, () => {
  test('admin logs in and the dashboard loads', async ({ page }) => {
    const account = adminAccount('admin');
    test.skip(!account, 'QA_ADMIN_EMAIL / QA_ADMIN_PASSWORD not set');

    await new AdminLoginPage(page).login(account!.email, account!.password);

    await expect(page).not.toHaveURL(/\/auth\/login|\/jury\//);
  });

  test('jury logs in and lands on the jury dashboard', { tag: '@jury' }, async ({ page }) => {
    const account = adminAccount('jury');
    test.skip(!account, 'QA_JURY_EMAIL / QA_JURY_PASSWORD not set');

    await new AdminLoginPage(page).login(account!.email, account!.password);

    await expect(page).toHaveURL(/\/jury\/dashboard/);
  });
});
