import { type Page } from '@playwright/test';
import { type AdminJson } from '../../../fixtures/cfa';
import { confirmSwal, waitForSubmitAction } from './adminAjax';

/**
 * Admin program list: {ADMIN_URL}/table/application_programs (sc-saas-admin modules/table.php,
 * template themes/default/html/table.php). "+ Add" opens a SweetAlert "Create Program" prompt
 * that posts createApplicationProgram and then navigates to the returned editUrl (the wizard).
 */
export class ProgramsTablePage {
  constructor(private readonly page: Page) {}

  async goto() {
    await this.page.goto('/table/application_programs');
  }

  /** Creates a program through "+ Add" and returns the createApplicationProgram JSON (incl. editUrl). */
  async createProgram(title: string): Promise<AdminJson> {
    await this.page.locator('#createApplicationProgramBtn').click();
    await this.page.locator('.swal2-popup .swal2-input').fill(title);
    const created = waitForSubmitAction(this.page, 'createApplicationProgram');
    await confirmSwal(this.page);
    return created;
  }
}
