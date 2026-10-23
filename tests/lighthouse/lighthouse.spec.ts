/**
 * SAN-1619: Lighthouse performance and accessibility budgets on the member PWA's login, startup
 * dashboard and startup profile pages. Owner: Ritu Raj.
 *
 * Read-only. Each page is audited LIGHTHOUSE_RUNS times (default 3) and the median is compared with
 * lighthouse/budgets.json (per E2E_ENV). Advisory until LIGHTHOUSE_ENFORCE=true: a miss is a
 * warning annotation, not a failure. Reports and summary.json land in lighthouse-reports/ (a CI
 * artifact); CI also renders summary.json into each run's job summary, so the Actions history is the
 * trend. Run with `npm run test:lighthouse` (the project only exists with LIGHTHOUSE=true).
 */
import * as fs from 'fs';
import * as path from 'path';
import { test } from '@playwright/test';
import { authFile, memberAccount } from '../../config/accounts';
import { env } from '../../config/env';
import { median, overBudget, REPORT_DIR, runLighthouse, type LighthouseResult, type PageBudget } from '../../fixtures/lighthouse';

/* Budgets are per environment: dev serves a non-production build, so its numbers differ a lot. */
const BUDGETS: Record<string, PageBudget> =
  JSON.parse(fs.readFileSync(path.join(__dirname, '../../lighthouse/budgets.json'), 'utf8'))[env.name] ?? {};
const RUNS = Number(process.env.LIGHTHOUSE_RUNS ?? 3);
const ENFORCE = process.env.LIGHTHOUSE_ENFORCE === 'true';

const PAGES: { name: string; path: string; needsLogin: boolean }[] = [
  { name: 'login', path: '/auth/login', needsLogin: false },
  { name: 'startup-dashboard', path: '/startups/dashboard', needsLogin: true },
  { name: 'startup-profile', path: '/startups/edit/startup-information', needsLogin: true },
];

/* One Chrome at a time (parallel audits would skew each other), but a failed page doesn't skip the
   rest the way serial mode would: the project sets fullyParallel: false, so one worker runs them in order. */

for (const target of PAGES) {
  test(`lighthouse: ${target.name}`, { tag: ['@regression', '@lighthouse', '@frontend', '@startup'] }, async () => {
    test.skip(target.needsLogin && !memberAccount('startup'), 'QA_STARTUP_EMAIL not set');
    test.setTimeout(RUNS * 120_000);
    const url = new URL(target.path, env.frontendUrl).toString();
    const runs: LighthouseResult[] = [];
    for (let i = 1; i <= RUNS; i++) {
      runs.push(await runLighthouse(url, `${target.name}-${i}`, target.needsLogin ? authFile('startup') : undefined));
    }
    const result = median(runs);
    const budget = BUDGETS[target.name];
    const misses = budget ? overBudget(result, budget) : [`no ${env.name} budget in lighthouse/budgets.json`];

    record(target.name, result, runs, misses);
    test.info().annotations.push({ type: 'lighthouse', description: `${target.name}: ${JSON.stringify(result)}` });
    if (misses.length && !ENFORCE) {
      test.info().annotations.push({ type: 'warning', description: `${target.name} over budget (advisory): ${misses.join('; ')}` });
    }
    if (ENFORCE && misses.length) throw new Error(`${target.name} over budget: ${misses.join('; ')}`);
  });
}

/** lighthouse-reports/summary.json: one entry per page, read by the CI job-summary step. */
function record(name: string, result: LighthouseResult, runs: LighthouseResult[], misses: string[]) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const summaryFile = path.join(REPORT_DIR, 'summary.json');
  const summary = fs.existsSync(summaryFile) ? JSON.parse(fs.readFileSync(summaryFile, 'utf8')) : { env: env.name, at: new Date().toISOString(), pages: {} };
  summary.pages[name] = { median: result, runs, misses };
  fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2));
}
