/**
 * CFA regression suite P7 (FT-006 / SAN-1885): the AI analysis pages load. Load checks only:
 * analyzer calls spend real LLM money and there is no mock.
 * Owner: Ritu Raj
 * Pass bar: the program's Analysis list, the New analysis run form and the AI Analyzer Cost Dashboard
 * render for the per-run program, and no request that would make the admin call the analyzer is sent.
 *
 * The browser never talks to the analyzer itself: every analyzer call is made by the admin PHP, on a
 * submitAction POST to the analysis page (startAllBackground, generateThesisDraft, the form upload, …).
 * The guard aborts every such POST and fails the test; only refreshAiCreditBalance (a credit balance
 * read) is let through. Gated by the tenant flags call_for_applications_analysis_enabled and
 * ai_analyzer_enabled. Read-only: nothing here writes.
 */
import { type Page } from '@playwright/test';
import { env } from '../../config/env';
import { expect, test, type CfaFlags } from '../../fixtures/cfa';

const TAGS = ['@regression', '@cfa', '@admin'];
const ALLOWED_ACTIONS = new Set(['refreshAiCreditBalance']);
const PHP_ERROR = /\b(Warning|Notice|Fatal error|Deprecated): .+ on line \d+/;

/** Aborts every analysis-page POST (other than ALLOWED_ACTIONS) and any request to an analyzer host; returns what it blocked. */
async function guardAnalyzer(page: Page): Promise<string[]> {
  const blocked: string[] = [];
  const adminHost = new URL(env.adminUrl).hostname;
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.hostname !== adminHost && /analy[sz]er/i.test(url.hostname)) {
      blocked.push(`${req.method()} ${req.url()}`);
      return route.abort();
    }
    if (req.method() === 'POST' && /\/analysis_[a-z_]+/.test(url.pathname)) {
      const action = /submitAction(?:=|"\r\n\r\n)([A-Za-z_]+)/.exec(req.postData() ?? '')?.[1] ?? '?';
      if (!ALLOWED_ACTIONS.has(action)) {
        blocked.push(`POST ${url.pathname} submitAction=${action}`);
        return route.abort();
      }
    }
    return route.continue();
  });
  return blocked;
}

function skipUnlessAnalysisEnabled(flags: CfaFlags) {
  test.skip(flags.call_for_applications_analysis_enabled !== true, 'call_for_applications_analysis_enabled is off on this tenant');
  test.skip(flags.ai_analyzer_enabled !== true, 'ai_analyzer_enabled is off on this tenant');
}

test.describe('CFA P7: AI analysis pages load', { tag: TAGS }, () => {
  let blocked: string[] = [];

  test.beforeEach(async ({ adminPage, cfaFlags }) => {
    blocked = [];
    skipUnlessAnalysisEnabled(cfaFlags);
    blocked = await guardAnalyzer(adminPage);
  });

  test.afterEach(async ({ adminPage }) => {
    await adminPage.waitForLoadState('networkidle').catch(() => undefined);
    expect(blocked, 'requests that would reach the analyzer').toEqual([]);
  });

  test("the program's Analysis list loads", async ({ adminPage, cfaProgram }) => {
    const response = await adminPage.goto(`/application_management/analysis_list/${cfaProgram.id}/${cfaProgram.adminSlug}`);
    expect(response?.ok(), 'analysis_list HTTP status').toBe(true);
    await expect(adminPage).toHaveTitle(/Program Analysis/);
    const body = adminPage.locator('body');
    await expect(body).toContainText(cfaProgram.title);
    await expect(body).toContainText('Total runs');
    await expect(adminPage.getByText('Add Analysis', { exact: true }).first()).toBeVisible();
    await expect(body).not.toContainText(PHP_ERROR);
  });

  test('the New analysis run form loads and is never submitted', async ({ adminPage, cfaProgram }) => {
    const response = await adminPage.goto(`/application_management/analysis_form/${cfaProgram.id}/${cfaProgram.adminSlug}`);
    expect(response?.ok(), 'analysis_form HTTP status').toBe(true);
    const body = adminPage.locator('body');
    await expect(body).toContainText('New analysis run');
    await expect(body).toContainText(cfaProgram.title);
    await expect(adminPage.locator('#analysisFor')).toBeVisible();
    await expect(adminPage.locator('#thesis')).toBeVisible();
    await expect(adminPage.locator('#acdCreditBalVal')).toHaveText(/\d/);
    await expect(body).not.toContainText(PHP_ERROR);
  });

  test('the AI Analyzer Cost Dashboard loads', async ({ adminPage }) => {
    const response = await adminPage.goto('/application_management/analysis_cost_dashboard');
    expect(response?.ok(), 'analysis_cost_dashboard HTTP status').toBe(true);
    await expect(adminPage).toHaveTitle(/AI Analyzer Cost Dashboard/);
    await expect(adminPage.locator('#analysisCostDashboard')).toBeVisible();
    await expect(adminPage.locator('#analysisCostDashboard')).toContainText('Total Spend');
    await expect(adminPage.locator('body')).not.toContainText(PHP_ERROR);
  });
});
