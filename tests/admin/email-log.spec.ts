/**
 * Journey 9 (SAN-1576): a platform email is sent and shows in the admin email log.
 * Owner: Ritu Raj
 * Pass bar: after an OTP email is requested for a seeded account, a new row for that
 * recipient appears in {ADMIN_URL}/email_logs/list with status "sent".
 *
 * Needs the QA admin to have can_broadcast_messages = 1 (the email log page requires it).
 * The OTP itself is masked in the stored subject (FA-009), so it is never asserted.
 */
import { expect, test } from '@playwright/test';
import { adminAccount, memberAccount } from '../../config/accounts';
import { env } from '../../config/env';
import { asRole } from '../../fixtures/auth';
import { newestEmailLogRowId, waitForNewEmailLogRow } from '../../fixtures/email-log';

const TEMPLATE = 'verify-email-address';

test.describe('email log', { tag: ['@smoke', '@admin', '@write'] }, () => {
  const recipient = memberAccount('investor')?.email;
  test.skip(!adminAccount('admin') || !recipient, 'needs QA admin + QA_INVESTOR_EMAIL');
  asRole('admin');

  test('an OTP email is logged as sent', async ({ page, request }) => {
    const before = await newestEmailLogRowId(page, recipient!, TEMPLATE);

    const sent = await request.post(`${env.apiUrl}/api/v1/public/otp_verifications/send`, {
      headers: { 'x-hostname': new URL(env.frontendUrl).hostname },
      data: { type: 'email', emailAddress: recipient },
    });
    expect(sent.ok(), `OTP send returned ${sent.status()}`).toBe(true);

    /* The log row is written by the backend right after the send; poll the page briefly. */
    await waitForNewEmailLogRow(page, recipient!, TEMPLATE, before);

    const row = page.locator('tbody#filteredData tr[recordId]').first();
    await expect(row.locator('.el-recipient')).toContainText(recipient!);
    await expect(row).toHaveAttribute('data-db-status', 'sent');
  });
});
