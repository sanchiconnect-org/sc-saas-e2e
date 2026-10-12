/**
 * Logs in once as every seeded member account and saves the browser state to
 * .auth/<role>.json, so PWA journeys start already logged in (see fixtures/auth.ts).
 * A role whose secret isn't configured is skipped.
 *
 * Tagged with every run tag so `--grep @smoke` / `--grep @regression` / `--grep @cfa` still logs in first.
 */
import { expect, test as setup } from '@playwright/test';
import { MEMBER_ROLES, authFile, memberAccount, qaOtp } from '../config/accounts';
import { LoginPage, dashboardPathFor } from '../pages/frontend/LoginPage';

for (const role of MEMBER_ROLES) {
  setup(`log in as ${role}`, { tag: ['@smoke', '@regression', '@cfa'] }, async ({ page }) => {
    const account = memberAccount(role);
    setup.skip(!account, `QA_${role.toUpperCase()}_EMAIL not set`);

    await new LoginPage(page).loginWithEmail(account!.email, qaOtp());
    await expect(page).toHaveURL(dashboardPathFor(role));

    await page.context().storageState({ path: authFile(role) });
  });
}
