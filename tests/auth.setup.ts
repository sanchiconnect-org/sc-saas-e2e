/**
 * Logs in once as every seeded account and saves the browser state to
 * .auth/<role>.json, so journeys start already logged in:
 *
 *   test.use({ storageState: authFile('investor') });
 *
 * A role whose secret isn't configured is skipped, and journeys that need it skip too.
 *
 * Tagged with every run tag so `--grep @smoke` / `--grep @regression` still logs in first.
 */
import { expect, test as setup } from '@playwright/test';
import { env } from '../config/env';
import { ADMIN_ROLES, MEMBER_ROLES, adminAccount, authFile, memberAccount, qaOtp } from '../config/accounts';
import { LoginPage, dashboardPathFor } from '../pages/frontend/LoginPage';
import { AdminLoginPage } from '../pages/admin/AdminLoginPage';

const RUN_TAGS = { tag: ['@smoke', '@regression'] };

for (const role of MEMBER_ROLES) {
  setup(`log in as ${role}`, RUN_TAGS, async ({ page }) => {
    const account = memberAccount(role);
    setup.skip(!account, `QA_${role.toUpperCase()}_EMAIL not set`);

    const login = new LoginPage(page);
    await login.loginWithEmail(account!.email, qaOtp());
    await expect(page).toHaveURL(dashboardPathFor(role));

    await page.context().storageState({ path: authFile(role) });
  });
}

for (const role of ADMIN_ROLES) {
  setup(`log in to admin panel as ${role}`, RUN_TAGS, async ({ browser }) => {
    const account = adminAccount(role);
    setup.skip(!account, `QA_${role.toUpperCase()}_EMAIL / _PASSWORD not set`);

    const context = await browser.newContext({ baseURL: env.adminUrl });
    const page = await context.newPage();
    await new AdminLoginPage(page).login(account!.email, account!.password);

    await context.storageState({ path: authFile(role) });
    await context.close();
  });
}
