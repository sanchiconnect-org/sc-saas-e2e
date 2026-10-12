/**
 * Journey 10 (SAN-1576): a startup uploads a pitch deck and it shows on its pitch-deck page.
 * Owner: Ritu Raj
 * Pass bar: POST /startups/pitch-deck/upload/pitch-file returns 2xx and the file
 * is listed under "Your pitch deck" after a reload.
 *
 * The PWA dashboard does not render the pitch deck (only profile completeness), so
 * "appears" is asserted where it is shown: /startups/edit/pitch-deck-documents.
 * The PPT/PDF → image carousel conversion is async (polled every 30s) and depends on
 * the converter service, so it is deliberately not part of the smoke pass bar.
 */
import * as path from 'path';
import { expect, test } from '@playwright/test';
import { memberAccount } from '../../config/accounts';
import { asRole } from '../../fixtures/auth';

const PITCH_FILE = path.resolve(__dirname, '../../fixtures/files/qa-pitch-deck.pdf');

test.describe('pitch deck upload', { tag: ['@smoke', '@frontend', '@startup', '@write'] }, () => {
  test.skip(!memberAccount('startup'), 'QA_STARTUP_EMAIL not set');
  asRole('startup');

  test('an uploaded PDF pitch deck is saved and listed', async ({ page }) => {
    await page.goto('/startups/edit/pitch-deck-documents');
    const fileInput = page.locator('input#fundraising-pitchRef');
    await expect(fileInput).toBeAttached();

    const uploaded = page.waitForResponse(
      (r) => r.url().includes('/startups/pitch-deck/upload/pitch-file') && r.request().method() === 'POST',
      { timeout: 60_000 },
    );
    await fileInput.setInputFiles(PITCH_FILE);
    const response = await uploaded;
    expect(response.ok(), `upload returned ${response.status()}`).toBe(true);

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Your pitch deck' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'qa-pitch-deck.pdf' })).toBeVisible();
  });
});
