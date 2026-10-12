import { type Locator, type Page, type Response } from '@playwright/test';

/**
 * PWA program list: {FRONTEND_URL}/call-for-applications (sc-saas-frontend modules/call-for-applications).
 * Anonymous visitors get CFA programs from GET public/application-programs-management; logged-in
 * members from GET application-programs-management. The backend leaves test-mode programs out of both.
 */
export class CallForApplicationsPage {
  constructor(private readonly page: Page) {}

  /** Opens the list and returns the CFA program-list API response the page rendered from. */
  async goto(): Promise<Response> {
    const programs = this.page.waitForResponse(
      (r) => /\/application-programs-management\/?(\?|$)/.test(r.url()) && r.request().method() === 'GET',
    );
    await this.page.goto('/call-for-applications');
    return programs;
  }

  /** A program card, by its exact title. */
  programCard(title: string): Locator {
    return this.page.locator('app-call-for-applications-card').filter({
      has: this.page.getByRole('heading', { name: title, exact: true }),
    });
  }
}
