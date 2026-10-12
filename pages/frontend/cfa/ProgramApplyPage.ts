import { type Locator, type Page } from '@playwright/test';

/**
 * PWA apply page for one program: {FRONTEND_URL}/programs/apply/{code}/{slug}
 * (sc-saas-frontend modules/programs/program-public-apply). Test-mode programs open here
 * by direct URL even though no program list shows them.
 */
export class ProgramApplyPage {
  constructor(private readonly page: Page) {}

  async goto(code: string, slug: string, opts: { autoStatusCheck?: boolean } = {}) {
    await this.page.goto(`/programs/apply/${code}/${slug}${opts.autoStatusCheck ? '?autoStatusCheck=true' : ''}`);
  }

  /** The program title heading at the top of the page (renders once the program has loaded). */
  programTitle(title: string): Locator {
    return this.page.getByRole('heading', { level: 2, name: title, exact: true });
  }
}
