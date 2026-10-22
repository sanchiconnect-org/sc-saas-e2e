import 'dotenv/config';
import { chromium } from '@playwright/test';
import { authFile } from './config/accounts';
import { env } from './config/env';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ storageState: authFile('startup'), baseURL: env.frontendUrl, viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();
  page.on('request', (r) => {
    if (['PATCH', 'PUT', 'POST'].includes(r.method()) && r.url().includes('/startups/')) console.log('REQ', r.method(), r.url());
  });
  page.on('response', (r) => {
    if (r.request().method() === 'GET' && /\/startups\/[a-z-]+$/.test(r.url())) console.log('GET', r.status(), r.url());
  });
  await page.goto('/startups/edit/startup-information');
  await page.waitForTimeout(4000);
  const tabs = await page.locator('a, .nav-link, li').filter({ hasText: /^(Basic Information|Industry\/Technology|Financials|Pitch Deck)$/ }).evaluateAll((els) =>
    els.map((e) => ({ tag: e.tagName, text: (e.textContent ?? '').trim(), href: e.getAttribute('href'), cls: e.className })),
  );
  console.log('TABS', JSON.stringify(tabs));
  const pct = await page.getByText(/Profile completion/).locator('xpath=..').innerText().catch(() => '');
  console.log('COMPLETION', pct.replace(/\s+/g, ' '));

  for (const name of ['Basic Information', 'Industry/Technology', 'Financials']) {
    await page.getByText(name, { exact: true }).first().click();
    await page.waitForTimeout(4000);
    console.log('\n===== ', name, page.url());
    const fields = await page.locator('form input, form select, form textarea, ng-select, p-dropdown, mat-select, [formcontrolname]').evaluateAll((els) =>
      els.map((e) => ({
        tag: e.tagName.toLowerCase(),
        id: e.id,
        name: e.getAttribute('name'),
        fcn: e.getAttribute('formcontrolname'),
        type: e.getAttribute('type'),
        ph: e.getAttribute('placeholder'),
        req: e.hasAttribute('required'),
        val: (e as HTMLInputElement).value ?? '',
        cls: (e.className || '').toString().slice(0, 60),
      })),
    );
    console.log(JSON.stringify(fields, null, 0));
    const labels = await page.locator('label').allInnerTexts();
    console.log('LABELS', JSON.stringify(labels.map((l) => l.trim()).filter(Boolean)));
    const buttons = await page.getByRole('button').allInnerTexts();
    console.log('BUTTONS', JSON.stringify(buttons.map((b) => b.trim()).filter(Boolean)));
    await page.screenshot({ path: `/tmp/profile-${name.replace(/\W+/g, '_')}.png`, fullPage: true });
  }
  await browser.close();
})();
