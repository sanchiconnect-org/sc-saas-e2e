/**
 * SAN-1617: the 2 visual screens that need a program, using this run's test-mode CFA program
 * (cfa-setup). Read-only. Owner: Ritu Raj.
 */
import { test } from '../../fixtures/cfa';
import { authFile } from '../../config/accounts';
import { env } from '../../config/env';
import { adminMasks, expectScreen, pwaMasks } from '../../fixtures/visual';

const TAGS = ['@regression', '@visual'];

test.describe('visual: program apply page (guest)', { tag: TAGS }, () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('pwa_install_dismissed', 'true'));
  });

  test('07 program apply page', async ({ page, cfaProgram }) => {
    await page.goto(`/programs/apply/${cfaProgram.code}/${cfaProgram.slug}`);
    await page.getByText(cfaProgram.title).first().waitFor();
    /* The per-run program title and its dates differ every run. */
    await expectScreen(page, '07-program-apply', [...pwaMasks(page), page.getByText(cfaProgram.title)]);
  });
});

test.describe('visual: admin applications table view', { tag: TAGS }, () => {
  test.use({ storageState: authFile('admin'), baseURL: env.adminUrl });

  test('10 admin applications table view', async ({ page, cfaProgram }) => {
    await page.goto(`/application_management/submission-application-management-tableview/${cfaProgram.id}/${cfaProgram.adminSlug}`);
    await page.getByRole('button', { name: '+ Add Round' }).waitFor();
    /* Rows are whatever the run's other tests seeded (or an empty state); the program title differs
       every run and is shown truncated in a level-3 heading. */
    await expectScreen(page, '10-admin-applications-table', [
      ...adminMasks(page),
      page.locator('tbody'),
      page.getByRole('heading', { level: 3 }),
    ]);
  });
});
