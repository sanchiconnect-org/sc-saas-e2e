import { type Page } from '@playwright/test';
import { parseAdminJson, type AdminJson } from '../../../fixtures/cfa';

/**
 * Waits for the admin page's own jQuery AJAX POST with submitAction=<action> (urlencoded or
 * multipart) and returns its parsed JSON body. Start waiting BEFORE the click that sends it.
 * Admin handlers answer HTTP 200 even on error, so callers assert on `error`/`success`.
 */
export async function waitForSubmitAction(
  page: Page,
  action: string,
  opts: { timeout?: number; bodyContains?: string } = {},
): Promise<AdminJson> {
  const { timeout = 30_000, bodyContains } = opts;
  const urlencoded = `submitAction=${action}`;
  const multipart = new RegExp(`name="submitAction"\\r?\\n\\r?\\n${action}\\r?\\n`);
  const response = await page.waitForResponse(
    (r) => {
      if (r.request().method() !== 'POST') return false;
      const body = r.request().postData() ?? '';
      if (!(body.split('&').includes(urlencoded) || multipart.test(body))) return false;
      if (bodyContains === undefined) return true;
      /* urlencoded values are decoded first (jQuery encodes spaces as +), so callers pass plain text. */
      const decoded = multipart.test(body) ? body : [...new URLSearchParams(body).values()].join('\n');
      return decoded.includes(bodyContains);
    },
    { timeout },
  );
  return parseAdminJson(action, response.status(), await response.text());
}

/** Clicks the confirm button of the open SweetAlert2 dialog (the admin's "Are you sure?" prompts). */
export async function confirmSwal(page: Page) {
  await page.locator('.swal2-popup .swal2-confirm').click();
}
