/**
 * CFA regression suite P6 (FT-006 / SAN-1884): downloads, leads, reports, timeline.
 * Owner: Ritu Raj
 * Pass bar: every application export (csv and xlsx) parses and lists the seeded applications; the bulk
 * PDF ZIP holds one PDF per selected application and matches the Download dropdown's manifest; the
 * detail page PDF is the application's PDF; a guest's uploaded file comes back in the detail and bulk
 * attachment ZIPs; a guest who stops at the Apply modal is a lead under this run's address; the Reports
 * counts match the program's table; the Timeline shows the moves and who made them; a jury rating
 * reaches the round's rating CSV and the ratings report.
 *
 * One throwaway test-mode program (P3 form with a file field, one round with a rating criterion), with
 * two CSV-seeded applications moved into R1. Leads have no delete path and pile up until SAN-1613, so
 * leads are only ever looked up by this run's sc_cfa_<runId> address. Run with --workers=1 (SAN-1893).
 */
import * as path from 'path';
import AdmZip from 'adm-zip';
import { type Browser, type Page } from '@playwright/test';
import * as XLSX from 'xlsx';
import { adminAccount, authFile } from '../../config/accounts';
import { env } from '../../config/env';
import {
  applicationNo,
  cfaEmail,
  createCfaProgram,
  decodeApplicantToken,
  deleteCfaProgram,
  expect,
  test,
  type AdminDownload,
  type CfaProgram,
  type CfaRun,
  type SeededApplication,
  type TableApplication,
} from '../../fixtures/cfa';
import { JuryRoundApplicationsPage } from '../../pages/admin/cfa/JuryRoundApplicationsPage';
import { ProgramApplyPage } from '../../pages/frontend/cfa/ProgramApplyPage';
import { FILE, P3_FORM, SHORT, rand, tableRow } from './p3-helpers';

const TAGS = ['@regression', '@cfa', '@admin', '@write'];
const PDF = path.resolve(__dirname, '..', '..', 'fixtures', 'files', 'qa-pitch-deck.pdf');
const BULK_TIMEOUT = 120_000;

function skipIfRunSkipped(run: CfaRun) {
  test.skip(!!run.skipReason, run.skipReason);
}

/** Every row of every sheet of a csv or xlsx download, cells as trimmed strings. */
function sheetRows(file: AdminDownload): string[][] {
  const book = /csv/.test(file.contentType)
    ? XLSX.read(file.body.toString('utf8').replace(/^\uFEFF/, ''), { type: 'string' })
    : XLSX.read(file.body, { type: 'buffer' });
  return book.SheetNames.flatMap((name) =>
    XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[name], { header: 1, defval: '' }).map((row) => row.map((c) => String(c).trim())),
  );
}

/** The files of a ZIP download (no directories). */
function zipFiles(file: AdminDownload) {
  return new AdmZip(file.body).getEntries().filter((e) => !e.isDirectory);
}

const isPdf = (data: Buffer) => data.subarray(0, 5).toString('latin1') === '%PDF-';

test.describe('CFA P6: downloads, leads, reports, timeline', { tag: TAGS }, () => {
  test.describe.configure({ mode: 'serial' });
  let program: CfaProgram;
  let r1: { id: string; name: string };
  let seeded: SeededApplication[];
  let seededRows: TableApplication[];

  test.beforeAll(async ({ cfaAdmin, cfaRun }) => {
    test.setTimeout(120_000);
    skipIfRunSkipped(cfaRun);
    program = await createCfaProgram(cfaAdmin, { runId: cfaRun.runId, label: 'p6-downloads', rounds: 1, bypassOtp: true, ratingCriteriaOnLastRound: true });
    await cfaAdmin.saveFormFields(program.formId, P3_FORM);
    r1 = (await cfaAdmin.programRounds(program)).find((r) => r.id === program.roundIds[0])!;
    seeded = await cfaAdmin.seedSubmittedApplications(program, 2, 'p6');
    await cfaAdmin.moveToRound(program, seeded.map((s) => s.id), r1.id);
    const table = await cfaAdmin.submittedApplications(program);
    seededRows = seeded.map((s) => table.find((r) => r.submissionId === s.id)!);
    expect(seededRows.every(Boolean), 'seeded applications in the table view').toBe(true);
  });

  test.afterAll(async ({ cfaAdmin }) => {
    if (program) await deleteCfaProgram(cfaAdmin, program.id);
  });

  for (const action of [
    'export_all_applications',
    'export_all_applications_xlsx',
    'download_program_data',
    'download_program_data_xlsx',
    'download_all_applications',
    'download_all_applications_xlsx',
  ]) {
    test(`${action} lists every seeded application`, async ({ cfaAdmin }) => {
      const file = await cfaAdmin.programDownload(program, action);
      const xlsx = action.endsWith('_xlsx');
      expect(file.fileName, 'attachment file name').toMatch(xlsx ? /\.xlsx$/ : /\.csv$/);
      expect(file.contentType).toMatch(xlsx ? /spreadsheetml/ : /text\/csv/);

      const rows = sheetRows(file);
      for (const s of seeded) {
        const row = rows.find((r) => r.some((c) => c.toLowerCase() === s.email));
        expect(row, `a row for ${s.email}`).toBeTruthy();
        expect(row!.some((c) => c.toLowerCase() === s.name.toLowerCase()), `${s.name} in ${JSON.stringify(row)}`).toBe(true);
      }
      if (action.startsWith('download_program_data')) {
        const currentRound = rows[0].indexOf('Current Round');
        expect(currentRound, 'Current Round column').toBeGreaterThanOrEqual(0);
        for (const s of seeded) {
          expect(rows.find((r) => r.some((c) => c.toLowerCase() === s.email))![currentRound], `current round of ${s.email}`).toBe(r1.name);
        }
      }
    });
  }

  test('bulk PDF: the ZIP holds one PDF per selected application, as the Download dropdown manifest lists', async ({ cfaAdmin }) => {
    test.setTimeout(BULK_TIMEOUT + 30_000);
    const ids = seeded.map((s) => s.id);
    const manifest = await cfaAdmin.bulkDownloadManifest(program, 'pdf', ids);
    expect(manifest).toMatchObject({ success: true, totalFiles: ids.length });
    expect(manifest.files.map((f) => f.url).sort(), 'one detail-page PDF per application').toEqual(
      seededRows.map((r) => `${env.adminUrl}/application-submission-detail/${r.detailId}/download_pdf`).sort(),
    );
    const expectedNames = manifest.files.map((f) => f.name).sort();

    const zip = await cfaAdmin.programDownload(program, 'download_bulk_pdf', ids, BULK_TIMEOUT);
    expect(zip.contentType).toMatch(/zip/);
    const files = zipFiles(zip);
    expect(files.map((f) => f.name).sort()).toEqual(expectedNames);
    for (const f of files) expect(isPdf(f.getData()), `${f.entryName} is a PDF`).toBe(true);
  });

  test("the detail page's PDF download is the application's PDF", async ({ cfaAdmin }) => {
    const [manifestFile] = (await cfaAdmin.bulkDownloadManifest(program, 'pdf', [seeded[0].id])).files;
    const file = await cfaAdmin.download(`/application-submission-detail/${seededRows[0].detailId}/download_pdf`);
    expect(file.contentType).toMatch(/application\/pdf/);
    expect(file.fileName, 'the name the bulk download gives this application').toBe(manifestFile.name);
    expect(isPdf(file.body)).toBe(true);
  });

  test("a guest's uploaded PDF comes back in the detail and bulk attachment ZIPs", { tag: '@frontend' }, async ({ cfaAdmin, cfaRun, page }) => {
    test.setTimeout(BULK_TIMEOUT + 90_000);
    const tag = rand();
    const applicant = { name: `QA p6file ${tag}`, email: cfaEmail(cfaRun.runId, `p6file_${tag}`) };

    const apply = new ProgramApplyPage(page);
    await apply.goto(program.code, program.slug);
    const modal = await apply.startApplication();
    expect((await modal.fillApplicant(applicant)).ok(), 'lead upsert').toBe(true);
    const firstSave = apply.firstSave(program.formUUID);
    await modal.submitWithoutOtp();
    const first = await apply.formReady(firstSave);
    /* SAN-1959: a bypass-OTP program's first save hands the new guest a token for that one submission;
       the file upload below and the rest of the session carry it. */
    const created = (await first.json())?.data ?? {};
    expect(decodeApplicantToken(created.applicantToken)).toMatchObject({ programUUID: program.uuid, sid: Number(created.id), src: 'created' });
    await apply.field(SHORT.key).fill(`QA p6 file ${tag}`);
    const [upload] = await Promise.all([
      page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes(`/submission/${program.formUUID}/upload-file`)),
      apply.fileInput(FILE.name).setInputFiles(PDF),
    ]);
    expect(upload.ok(), `upload-file: HTTP ${upload.status()}`).toBe(true);
    await expect(apply.uploadedFiles(FILE.name)).toBeVisible();
    const { applyStatus } = await apply.submitApplication(program);
    expect(applyStatus, 'apply').toBeLessThan(300);

    const row = await tableRow(cfaAdmin, program, (r) => r.email === applicant.email);

    const detailZip = await cfaAdmin.download(`/application-submission-detail/${row.detailId}/download_attachments`, BULK_TIMEOUT);
    expect(detailZip.contentType, 'detail download_attachments').toMatch(/zip/);
    const detailFiles = zipFiles(detailZip);
    expect(detailFiles, 'files in the detail attachments ZIP').toHaveLength(1);
    expect(isPdf(detailFiles[0].getData()), `${detailFiles[0].entryName} is the uploaded PDF`).toBe(true);

    const manifest = await cfaAdmin.bulkDownloadManifest(program, 'attachments', [row.submissionId]);
    expect(manifest).toMatchObject({ success: true, totalFiles: 1 });
    const bulkZip = await cfaAdmin.programDownload(program, 'download_bulk_attachments', [row.submissionId], BULK_TIMEOUT);
    expect(bulkZip.contentType, 'download_bulk_attachments').toMatch(/zip/);
    const bulkFiles = zipFiles(bulkZip);
    expect(bulkFiles, 'files in the bulk attachments ZIP').toHaveLength(1);
    expect(isPdf(bulkFiles[0].getData())).toBe(true);

    /* A CSV-seeded application has no files: the admin answers in plain text instead of a ZIP. */
    const none = await cfaAdmin.download(`/application-submission-detail/${seededRows[0].detailId}/download_attachments`);
    expect(none.fileName).toBeNull();
    expect(none.body.toString('utf8')).toMatch(/No attachments found/);
  });

  test('a guest who stops at the Apply modal is a lead of the program under their address', { tag: '@frontend' }, async ({ cfaAdmin, cfaRun, page }) => {
    const tag = rand();
    const applicant = { name: `QA p6lead ${tag}`, email: cfaEmail(cfaRun.runId, `p6lead_${tag}`) };
    const apply = new ProgramApplyPage(page);
    await apply.goto(program.code, program.slug);
    const modal = await apply.startApplication();
    expect((await modal.fillApplicant(applicant)).ok(), 'lead upsert').toBe(true);

    const leads = await cfaAdmin.programLeads(program.id, applicant.email);
    expect(leads.map((l) => ({ name: l.name, email: l.email }))).toEqual([{ name: applicant.name, email: applicant.email }]);
    expect(leads[0].status, 'lead status pill').toBeTruthy();
  });

  test("the Reports page counts match the program's submissions table", async ({ cfaAdmin }) => {
    const counts = await cfaAdmin.programReportCounts(program);
    const submitted = (await cfaAdmin.submittedApplications(program)).length;
    expect(counts.submitted, 'Submitted Applications').toBe(submitted);
    expect(counts.total, 'Total = Submitted + Draft').toBe(counts.submitted + counts.draft);
  });

  test('the Timeline shows the seeded applications in R1, moved by the QA admin', async ({ cfaAdmin }) => {
    const admin = adminAccount('admin');
    test.skip(!admin, 'QA_ADMIN_EMAIL not set');
    const adminName = (await cfaAdmin.adminUser(admin!.email)).name;
    const timeline = await cfaAdmin.programTimeline(program);
    for (const s of seeded) {
      const row = timeline.find((t) => t.applicationNo === applicationNo(s.id));
      expect(row, `${applicationNo(s.id)} on the timeline`).toBeTruthy();
      expect(row!.currentRound).toBe(r1.name);
      expect(row!.movedBy).toContain(adminName);
    }
  });

  test("a jury rating reaches the round's rating CSV and the ratings report", { tag: '@jury' }, async ({ browser, cfaAdmin }) => {
    const jury = adminAccount('jury');
    test.skip(!jury, 'QA_JURY_EMAIL / QA_JURY_PASSWORD not set');
    const juryId = await cfaAdmin.adminUserId(jury!.email);
    const [s] = seeded;
    await cfaAdmin.addJuryToRound(r1.id, juryId);
    await cfaAdmin.allotJury(program, r1.id, s.id, juryId);
    const comment = `[QA] P6 rating ${s.email}`;

    const { page, close } = await juryPage(browser);
    try {
      const list = new JuryRoundApplicationsPage(page);
      await list.goto(program, r1.id);
      await list.application(s.name).click();
      await expect(list.ratingForm.locator(`input[name="data[submission_id]"][value="${s.id}"]`)).toHaveCount(1);
      expect((await list.rate({ stars: 3, comment })).ok(), 'addRating').toBe(true);
    } finally {
      await close();
    }

    const csv = await cfaAdmin.programDownload(program, `${r1.id}/download_csv`);
    expect(csv.contentType).toMatch(/text\/csv/);
    const csvRow = sheetRows(csv).find((r) => r.includes(comment));
    expect(csvRow, `rating CSV row with the comment in ${JSON.stringify(sheetRows(csv))}`).toBeTruthy();
    expect(csvRow!.some((c) => /^3(\.0+)?$/.test(c)), `a 3-star score in ${JSON.stringify(csvRow)}`).toBe(true);

    const report = sheetRows({ body: await cfaAdmin.ratingsReport(program), contentType: 'xlsx', fileName: null });
    expect(report.find((r) => r.includes(comment)), 'ratings report row with the comment').toBeTruthy();
  });
});

/** A page in its own browser context on the saved jury session (.auth/jury.json), baseURL = ADMIN_URL. */
async function juryPage(browser: Browser): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ storageState: authFile('jury'), baseURL: env.adminUrl });
  return { page: await context.newPage(), close: () => context.close() };
}
