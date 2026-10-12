/**
 * Journey 7 (SAN-1576): an admin opens the admin panel and the dashboard loads.
 * Owner: Ritu Raj
 * Pass bar: with the saved admin session, the dashboard renders its greeting within the default timeouts.
 */
import { expect, test } from '@playwright/test';
import { adminAccount } from '../../config/accounts';
import { asRole } from '../../fixtures/auth';

test.describe('admin dashboard', { tag: ['@smoke', '@admin'] }, () => {
  test.skip(!adminAccount('admin'), 'QA_ADMIN_EMAIL / QA_ADMIN_PASSWORD not set');
  asRole('admin');

  test('the dashboard loads for a logged-in admin', async ({ page }) => {
    await page.goto('/');

    await expect(page).not.toHaveURL(/\/auth\/login/);
    /* sc-saas-admin modules/index.php sets page_title "Admin Panel"; the header renders "<page_title> | <brand>". */
    await expect(page).toHaveTitle(/^Admin Panel/);
    /* Greeting block at the top of themes/default/html/index.php */
    await expect(page.getByRole('heading', { level: 4 }).filter({ hasText: 'Your IP is' })).toBeVisible();
  });
});
