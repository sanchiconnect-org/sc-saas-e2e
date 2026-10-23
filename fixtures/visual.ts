import * as path from 'path';
import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * SAN-1617 visual checks. One above-the-fold screenshot per screen, compared with the committed
 * baseline for this project (desktop / phone) and platform (CI = linux).
 *
 * The QA tenant is live: names, counts, dates and notifications change between runs. Those regions
 * are masked; what's left is the layout, branding and navigation chrome, which is what a visual
 * regression breaks.
 *
 * Tolerance is an absolute pixel count per device, set between the measured run-to-run noise and a
 * deliberate 1-pixel layout shift (2026-10-22, development): desktop noise ≤ 1,272 px vs shift 9,237 px;
 * phone noise ≤ 663 px vs shift 2,141 px. A 2% ratio let the 1px shift through, so ratios aren't used.
 * Re-tune from a week of nightly runs (SAN-1617); VISUAL_MAX_DIFF_PIXELS overrides for measuring.
 */
const MAX_DIFF_PIXELS: Record<string, number> = { 'visual-desktop': 4_000, 'visual-phone': 1_200 };

/*
 * Small elements that may or may not render from one run to the next (badges, counters, avatars,
 * toasts, dates) are HIDDEN with CSS rather than masked: a mask box is drawn only where the element
 * exists, so a badge present in one run and absent in the next costs hundreds of pixels, while a
 * hidden element looks identical either way and still takes its place in the layout.
 */
const HIDE_VOLATILE_CSS = path.join(__dirname, 'visual-hide.css');

/** Wait until the page has stopped loading and fonts are ready, hide volatile bits, then compare. */
export async function expectScreen(page: Page, name: string, mask: Locator[] = []) {
  /* The PWA keeps polling, so network idle may never come: give it 5 s at most. */
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
  await page.evaluate(() => document.fonts?.ready);
  const project = test.info().project.name;
  const maxDiffPixels = Number(process.env.VISUAL_MAX_DIFF_PIXELS ?? MAX_DIFF_PIXELS[project] ?? 1_200);
  await expect(page).toHaveScreenshot(`${name}.png`, {
    fullPage: false,
    animations: 'disabled',
    caret: 'hide',
    mask,
    maxDiffPixels,
    stylePath: HIDE_VOLATILE_CSS,
  });
}

/** Volatile text on the member PWA that has no stable class: the time-of-day greeting. */
export function pwaMasks(page: Page): Locator[] {
  return [page.getByText(/^\s*Good (Morning|Afternoon|Evening|Night)/i)];
}

/** Volatile text on the admin panel: the greeting (name + IP), alerts, the "items need attention" button. */
export function adminMasks(page: Page): Locator[] {
  return [
    page.getByRole('heading', { level: 4 }).filter({ hasText: 'Your IP is' }),
    page.locator('.alert'),
    page.getByRole('button', { name: /items need attention/ }),
  ];
}
