/**
 * Logs in once as the admin and jury accounts and saves the browser state to
 * .auth/<role>.json. Create these users by hand in the QA tenant's admin panel
 * first (see README). A role whose secrets aren't configured is skipped.
 *
 * Tagged with every run tag so `--grep @smoke` / `--grep @regression` / `--grep @cfa` still logs in first.
 */
import { test as setup } from '@playwright/test';
import { ADMIN_ROLES, adminAccount, authFile } from '../config/accounts';
import { AdminLoginPage } from '../pages/admin/AdminLoginPage';

for (const role of ADMIN_ROLES) {
  setup(`log in to admin panel as ${role}`, { tag: ['@smoke', '@regression', '@cfa'] }, async ({ page }) => {
    const account = adminAccount(role);
    setup.skip(!account, `QA_${role.toUpperCase()}_EMAIL / _PASSWORD not set`);

    await new AdminLoginPage(page).login(account!.email, account!.password);

    await page.context().storageState({ path: authFile(role) });
  });
}
