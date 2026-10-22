import { chromium } from '@playwright/test';
import { env } from './config/env';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ baseURL: env.frontendUrl, storageState: '.auth/program_office.json' });
  const page = await ctx.newPage();
  await page.addInitScript(() => localStorage.setItem('skip-first-login-modal', 'true'));
  await page.goto('/program-office-members/dashboard', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(3000);
  console.log('url', page.url());
  console.log('title', await page.title());
  const nav = (await page.locator('a, button, .menu-link, .menu-title').allTextContents())
    .map((t) => t.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  console.log(
    'nav',
    [...new Set(nav)].filter((t) => /program|round|appl|jury|approv|reject|review|connect|dashboard/i.test(t)).slice(0, 40),
  );
  const hrefs = await page.locator('a[href]').evaluateAll((as) =>
    [...new Set(as.map((a) => (a as HTMLAnchorElement).getAttribute('href') || ''))].filter((h) =>
      /program|appl|round|jury|manage/i.test(h),
    ),
  );
  console.log('hrefs', hrefs.slice(0, 30));
  await browser.close();
}
main();
