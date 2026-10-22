import * as fs from 'fs';
import * as path from 'path';
import AxeBuilder from '@axe-core/playwright';
import { type Page, type TestInfo } from '@playwright/test';

export type A11yReport = {
  journey: string;
  url: string;
  timestamp: string;
  /** WCAG A + AA violations (axe tags wcag2a, wcag2aa, wcag21a, wcag21aa). */
  violations: {
    id: string;
    impact: string | null | undefined;
    description: string;
    helpUrl: string;
    nodes: number;
    /** True when this is the duplicate-form-label class of defect SAN-1610 calls out. */
    isDuplicateLabel: boolean;
  }[];
  violationCount: number;
  duplicateLabelCount: number;
};

const REPORT_DIR = path.resolve('a11y-reports');

function isDuplicateLabel(id: string, description: string): boolean {
  const blob = `${id} ${description}`.toLowerCase();
  return (
    id === 'label' ||
    id === 'form-field-multiple-labels' ||
    (blob.includes('duplicate') && blob.includes('label')) ||
    blob.includes('multiple label')
  );
}

/**
 * Run axe (WCAG 2 A/AA) on the current page and write a JSON report under a11y-reports/.
 * Advisory (SAN-1610): never throws on violations — callers log the counts.
 */
export async function runAxeAdvisory(page: Page, journey: string, testInfo?: TestInfo): Promise<A11yReport> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();

  const violations = results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    description: v.description,
    helpUrl: v.helpUrl,
    nodes: v.nodes.length,
    isDuplicateLabel: isDuplicateLabel(v.id, v.description),
  }));

  const report: A11yReport = {
    journey,
    url: page.url(),
    timestamp: new Date().toISOString(),
    violations,
    violationCount: violations.reduce((n, v) => n + v.nodes, 0),
    duplicateLabelCount: violations.filter((v) => v.isDuplicateLabel).reduce((n, v) => n + v.nodes, 0),
  };

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const safe = journey.replace(/[^\w.-]+/g, '_');
  const file = path.join(REPORT_DIR, `${safe}.json`);
  fs.writeFileSync(file, JSON.stringify(report, null, 2));

  if (testInfo) {
    await testInfo.attach(`a11y-${safe}`, {
      path: file,
      contentType: 'application/json',
    });
  }

  return report;
}
