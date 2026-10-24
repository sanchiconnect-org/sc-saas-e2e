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
    /* The run's other CFA tests add applications to this program while it runs, and the table's size
       and header row change with them (2026-10-24: 0 rows at baseline, 4 in the nightly). A search
       that matches nothing always gives the same empty table. */
    const search = page.getByPlaceholder('Search by keyword');
    await search.fill('qa-visual-no-such-application');
    await search.press('Enter');
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
    /* Masked: the program title (truncated, level-3 heading), the round tab names (they carry the run
       id), the submissions count, the remembered page-size choice, and the empty-state text. */
    await expectScreen(page, '10-admin-applications-table', [
      ...adminMasks(page),
      page.locator('tbody'),
      page.getByRole('heading', { level: 3 }),
      page.getByText(/^\s*\[QA\] R\d+-/),
      page.getByRole('button', { name: /submissions/i }),
      page.getByText(/^\s*\d+ records\s*$/),
    ]);
  });
});
