import { expect, type Page } from '@playwright/test';

/**
 * Admin email log helpers ({ADMIN_URL}/email_logs/list), shared by the smoke email journey
 * and the CFA suite (FT-006). `page` must be logged in as the QA admin, who needs
 * can_broadcast_messages = 1 to open the email log page.
 *
 * Template codes are the backend's kebab-case codes (sc-saas-backend enum.ts),
 * e.g. verify-email-address, application-program-management-application.
 */

/** recordId of the newest email-log row for `recipient` + `templateCode`, or null if there is none. */
export async function newestEmailLogRowId(page: Page, recipient: string, templateCode: string): Promise<string | null> {
  await page.goto(
    `/email_logs/list?recipient=${encodeURIComponent(recipient)}&template_code=${encodeURIComponent(templateCode)}`,
  );
  await expect(page).not.toHaveURL(/\/403|\/auth\/login/);
  const first = page.locator('tbody#filteredData tr[recordId]').first();
  return (await first.count()) ? first.getAttribute('recordId') : null;
}

/**
 * Waits until a row newer than `before` is logged for `recipient` + `templateCode`.
 * The backend writes the row right after the send, so a short poll is enough.
 */
export async function waitForNewEmailLogRow(
  page: Page,
  recipient: string,
  templateCode: string,
  before: string | null,
  timeout = 30_000,
): Promise<void> {
  await expect
    .poll(async () => newestEmailLogRowId(page, recipient, templateCode), {
      timeout,
      intervals: [2_000, 3_000, 5_000],
    })
    .not.toBe(before);
}
