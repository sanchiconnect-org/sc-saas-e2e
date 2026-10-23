/**
 * SAN-1619: Lighthouse on the member PWA. Lighthouse drives its own Chrome tab over the DevTools
 * port, so each audit gets a throwaway Chromium profile (Playwright's build) that already holds the
 * saved session from .auth/<role>.json: cookies plus localStorage. No new login happens, which keeps
 * the single-session rule (CLAUDE.md hard rule 3).
 */
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { chromium } from '@playwright/test';

export const REPORT_DIR = 'lighthouse-reports';

/** What is compared against lighthouse/budgets.json: category scores 0–100, timings in ms. */
export interface LighthouseResult {
  performance: number;
  accessibility: number;
  lcpMs: number;
  tbtMs: number;
  cls: number;
}

export interface PageBudget {
  minPerformance: number;
  minAccessibility: number;
  maxLcpMs: number;
  maxTbtMs: number;
  maxCls: number;
}

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });

/** Pages that get in the way of the audit (install banner, first-login modal) start dismissed. */
const QUIET_STORAGE: Record<string, string> = { pwa_install_dismissed: 'true', 'skip-first-login-modal': 'true' };

/**
 * One Lighthouse run of `url` (mobile preset, simulated throttling: Lighthouse's defaults).
 * Writes <name>.report.html and .json into REPORT_DIR and returns the numbers the budgets use.
 */
export async function runLighthouse(url: string, name: string, storageStatePath?: string): Promise<LighthouseResult> {
  /* lighthouse is ESM-only; the dynamic import keeps this file loadable from Playwright's CJS. */
  const { default: lighthouse } = await import('lighthouse');
  const port = await freePort();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-lighthouse-'));
  const context = await chromium.launchPersistentContext(profile, {
    headless: true,
    args: [`--remote-debugging-port=${port}`],
  });
  try {
    const origin = new URL(url).origin;
    const state = storageStatePath ? JSON.parse(fs.readFileSync(storageStatePath, 'utf8')) : { cookies: [], origins: [] };
    await context.addCookies(state.cookies);
    const items: Record<string, string> = { ...QUIET_STORAGE };
    for (const entry of state.origins.find((o: { origin: string }) => o.origin === origin)?.localStorage ?? []) {
      items[entry.name] = entry.value;
    }
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(origin);
    await page.evaluate((all) => Object.entries(all).forEach(([k, v]) => window.localStorage.setItem(k, v)), items);

    const result = await lighthouse(url, {
      port,
      output: ['html', 'json'],
      onlyCategories: ['performance', 'accessibility'],
      /* keep the session we just put in the profile */
      disableStorageReset: true,
      logLevel: 'error',
    });
    if (!result) throw new Error(`Lighthouse returned nothing for ${url}`);
    const { lhr, report } = result;
    if (lhr.runtimeError) throw new Error(`Lighthouse failed on ${url}: ${lhr.runtimeError.code} ${lhr.runtimeError.message}`);
    /* A redirect to the login page means the session didn't carry over: the numbers would be for the wrong page. */
    if (new URL(lhr.finalDisplayedUrl).pathname !== new URL(url).pathname) {
      throw new Error(`Lighthouse ended on ${lhr.finalDisplayedUrl}, not ${url}`);
    }

    fs.mkdirSync(REPORT_DIR, { recursive: true });
    const [html, json] = report as string[];
    fs.writeFileSync(path.join(REPORT_DIR, `${name}.report.html`), html);
    fs.writeFileSync(path.join(REPORT_DIR, `${name}.report.json`), json);

    const audit = (id: string) => lhr.audits[id]?.numericValue ?? NaN;
    return {
      performance: Math.round((lhr.categories.performance?.score ?? 0) * 100),
      accessibility: Math.round((lhr.categories.accessibility?.score ?? 0) * 100),
      lcpMs: Math.round(audit('largest-contentful-paint')),
      tbtMs: Math.round(audit('total-blocking-time')),
      cls: Number(audit('cumulative-layout-shift').toFixed(3)),
    };
  } finally {
    await context.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

/** Lighthouse scores move run to run; the median of a few runs is what's compared. */
export function median(results: LighthouseResult[]): LighthouseResult {
  const mid = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  return {
    performance: mid(results.map((r) => r.performance)),
    accessibility: mid(results.map((r) => r.accessibility)),
    lcpMs: mid(results.map((r) => r.lcpMs)),
    tbtMs: mid(results.map((r) => r.tbtMs)),
    cls: mid(results.map((r) => r.cls)),
  };
}

/** Every budget the result misses, as readable lines (empty = within budget). */
export function overBudget(result: LighthouseResult, budget: PageBudget): string[] {
  const misses: string[] = [];
  if (result.performance < budget.minPerformance) misses.push(`performance ${result.performance} < ${budget.minPerformance}`);
  if (result.accessibility < budget.minAccessibility) misses.push(`accessibility ${result.accessibility} < ${budget.minAccessibility}`);
  if (result.lcpMs > budget.maxLcpMs) misses.push(`LCP ${result.lcpMs} ms > ${budget.maxLcpMs} ms`);
  if (result.tbtMs > budget.maxTbtMs) misses.push(`TBT ${result.tbtMs} ms > ${budget.maxTbtMs} ms`);
  if (result.cls > budget.maxCls) misses.push(`CLS ${result.cls} > ${budget.maxCls}`);
  return misses;
}
