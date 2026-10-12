import { test } from '@playwright/test';
import { QARole, authFile } from '../config/accounts';

/**
 * Start every test in the current describe block already logged in as `role`,
 * using the session tests/auth.setup.ts saved to .auth/<role>.json.
 *
 *   test.describe('investor connects with a startup', () => {
 *     asRole('investor');
 *     test('...', async ({ page }) => { ... });
 *   });
 *
 * Skip the block yourself when the role's secret isn't configured
 * (see tests/frontend/seeded-accounts.spec.ts), otherwise the missing
 * .auth file fails the test loudly — which is what you want in CI.
 */
export function asRole(role: QARole) {
  test.use({ storageState: authFile(role) });
}
