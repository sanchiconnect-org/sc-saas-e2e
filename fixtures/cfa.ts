import * as fs from 'fs';
import * as path from 'path';
import { test as base, request as playwrightRequest, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { adminAccount, authFile } from '../config/accounts';
import { env } from '../config/env';

/**
 * CFA (Call for Applications) regression fixture — FT-006 P1.
 *
 * Each run gets its own test-mode program, created by tests/cfa.setup.ts and deleted by
 * tests/cfa.teardown.ts. Test mode keeps it out of every public and member program list
 * (backend application-programs.repository.ts filters testModeEnabled=false) while the
 * apply page still opens by direct URL.
 *
 * The admin panel has no REST API. Every admin write here is the same jQuery AJAX POST the
 * UI makes: form field submitAction=<name>, posted to the admin page URL on the saved admin
 * session (.auth/admin.json). Responses are JSON {error, success, errorMessage, ...} with
 * HTTP 200 even on error, so the body is what gets checked. Handlers used (sc-saas-admin):
 *   createApplicationProgram, deleteApplicationProgram   modules/table.php
 *   editProgram, changeTestMode, makeProgramLive         modules/application_management/program.php
 *   importFieldsFromForm                                 modules/form-management/edit-form.php
 *   createProgramRound, deleteRound, getProgramRounds,
 *   import_applications_csv                              modules/application_management/submission-application-management.php
 *   update_rating_criteria                               modules/application_management/edit_program_round.php
 *   moveToSubmitted                                      modules/application_management/draft_applications.php
 *   (version list, GET)                                  modules/form-management/versions.php
 * Renaming any of these in sc-saas-admin breaks this file.
 */

/* ---------- Run state on disk (.cfa/, git-ignored) ---------- */

const CFA_DIR = path.resolve(__dirname, '..', '.cfa');
export const CFA_RUN_FILE = path.join(CFA_DIR, 'run.json');
/* One file per program this machine created and has not yet deleted; teardown deletes whatever is left. */
const PROGRAM_RECORDS_DIR = path.join(CFA_DIR, 'programs');

/** Cockpit flags the CFA suite reads (never writes). null = the tenant-verification response does not expose it. */
export const CFA_FLAGS = [
  'application_management',
  'application_management_round_status_updates',
  'call_for_applications_submitted_email_enabled',
  'limit_jury_access_enabled',
  'jury_nda_enabled',
] as const;
export type CfaFlag = (typeof CFA_FLAGS)[number];
export type CfaFlags = Record<CfaFlag, boolean | null>;

export interface CfaProgram {
  /** application_programs.id (admin) */
  id: string;
  uuid: string;
  /** program_code, the first segment of the PWA apply URL */
  code: string;
  /** slug of the PWA apply URL: /programs/apply/{code}/{slug} */
  slug: string;
  /** slug used in admin URLs (from createApplicationProgram's editUrl) */
  adminSlug: string;
  title: string;
  formId: string;
  formUUID: string;
  /** application_program_rounds.id, in creation order */
  roundIds: string[];
  runId: string;
}

export interface CfaRun {
  runId: string;
  /** Set when the cfa project must skip, e.g. a missing secret. */
  skipReason?: string;
  flags?: CfaFlags;
  program?: CfaProgram;
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

export function writeCfaRun(run: CfaRun) {
  ensureDir(CFA_DIR);
  fs.writeFileSync(CFA_RUN_FILE, JSON.stringify(run, null, 2));
}

export function readCfaRun(): CfaRun | undefined {
  if (!fs.existsSync(CFA_RUN_FILE)) return undefined;
  return JSON.parse(fs.readFileSync(CFA_RUN_FILE, 'utf8')) as CfaRun;
}

export function removeCfaRun() {
  fs.rmSync(CFA_RUN_FILE, { force: true });
}

export interface ProgramRecord {
  id: string;
  title: string;
  runId: string;
}

/** Remembers a program this machine created, so cfa-teardown deletes it even if the test that made it crashes. */
export function recordProgram(record: ProgramRecord) {
  ensureDir(PROGRAM_RECORDS_DIR);
  fs.writeFileSync(path.join(PROGRAM_RECORDS_DIR, `${record.id}.json`), JSON.stringify(record));
}

function forgetProgram(id: string) {
  fs.rmSync(path.join(PROGRAM_RECORDS_DIR, `${id}.json`), { force: true });
}

export function recordedPrograms(): ProgramRecord[] {
  if (!fs.existsSync(PROGRAM_RECORDS_DIR)) return [];
  return fs
    .readdirSync(PROGRAM_RECORDS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(PROGRAM_RECORDS_DIR, f), 'utf8')) as ProgramRecord);
}

/* ---------- Run id, names, addresses ---------- */

const RUN_ID = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})-[a-z0-9]+$/;
/* Every program this suite creates is titled "[QA] CFA run-<runId>[ <label>]". The run id starts
   with its UTC start time, which is how the orphan sweep tells a crashed run's program from a live one. */
const RUN_TITLE = /^\[QA\] CFA run-(\d{8}-\d{4}-[a-z0-9]+)(?:\s|$)/;

/** <yyyymmdd-hhmm>-<4 random chars>, UTC. */
export function newCfaRunId(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}-${p(now.getUTCHours())}${p(now.getUTCMinutes())}`;
  const random = Math.random().toString(36).slice(2, 6).padEnd(4, '0');
  return `${stamp}-${random}`;
}

/** The run id for this run: CFA_RUN_ID if set (CI may pin it), otherwise a fresh one. */
export function cfaRunId(): string {
  const pinned = process.env.CFA_RUN_ID?.trim();
  if (!pinned) return newCfaRunId();
  if (!RUN_ID.test(pinned)) {
    throw new Error(`CFA_RUN_ID "${pinned}" must look like 20261012-1530-ab12 (UTC start time + random suffix)`);
  }
  return pinned;
}

/** UTC start time encoded in a run id, or null if it isn't one. */
export function runStartedAt(runId: string): Date | null {
  const m = RUN_ID.exec(runId);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
}

export function cfaProgramTitle(runId: string, label?: string): string {
  return `[QA] CFA run-${runId}${label ? ` ${label}` : ''}`;
}

/** The run id in a "[QA] CFA run-<runId>..." title, or null for any other title. */
export function runIdFromTitle(title: string): string | null {
  const m = RUN_TITLE.exec(title.trim());
  return m && runStartedAt(m[1]) ? m[1] : null;
}

/**
 * A per-run applicant address, e.g. sc_cfa_20261012_1530_ab12_3@yopmail.com.
 * Built from QA_CFA_EMAIL_PATTERN when set. Tests that need the fixed guest OTP must
 * skip when the pattern is unset; CSV-seeded rows never get an OTP, so they fall back
 * to the same shape.
 */
export function cfaEmail(runId: string, suffix: string | number, pattern = env.cfa.emailPattern ?? 'sc_cfa_*@yopmail.com'): string {
  if (!pattern.includes('*')) throw new Error(`QA_CFA_EMAIL_PATTERN "${pattern}" has no "*"`);
  return pattern.replace('*', `${runId}_${suffix}`.replace(/-/g, '_')).toLowerCase();
}

/** Why the cfa project can't run here, or undefined if it can. */
export function cfaPrerequisiteSkipReason(input: { adminConfigured: boolean; templateFormId?: string }): string | undefined {
  if (!input.adminConfigured) return 'QA_ADMIN_EMAIL / QA_ADMIN_PASSWORD not set: the CFA suite drives the admin panel';
  if (!input.templateFormId) return 'QA_CFA_TEMPLATE_FORM_ID not set: create "[QA] E2E template form" once and store its id (FT-006)';
  return undefined;
}

/* ---------- Flags (read once per run) ---------- */

/**
 * Reads the CFA flags from the tenant-verification response the PWA itself loads at boot
 * (cockpit GET public/global/resolve-domain/:hostname, same shape as verify_tenant).
 * Only the five flag values are kept; the rest of that response is never stored.
 */
export async function readCfaFlags(browser: Browser): Promise<CfaFlags> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const host = new URL(env.frontendUrl).hostname;
    const resolved = page.waitForResponse(
      (r) => r.url().includes(`/resolve-domain/${host}`) && r.request().method() === 'GET',
      { timeout: 30_000 },
    );
    await page.goto(env.frontendUrl);
    const response = await resolved;
    if (!response.ok()) throw new Error(`resolve-domain/${host} returned ${response.status()}`);
    const body = await response.json();
    const features: Record<string, unknown> = body?.data?.features ?? {};
    const flags = {} as CfaFlags;
    for (const flag of CFA_FLAGS) {
      if (!(flag in features)) {
        flags[flag] = null;
      } else {
        const v = features[flag];
        flags[flag] = v === true || v === 1 || v === '1';
      }
    }
    return flags;
  } finally {
    await context.close();
  }
}

/* ---------- Admin submitAction client ---------- */

export interface AdminJson {
  error?: boolean;
  success?: boolean;
  errorMessage?: string | null;
  successMessage?: string | null;
  editUrl?: string;
  lastRoundUrl?: string;
  [key: string]: unknown;
}

/** Dev shows PHP warnings inline, so a JSON body can come after a "<b>Warning</b>..." block. */
export function parseAdminJson(action: string, status: number, body: string): AdminJson {
  let start = body.indexOf('{"error"');
  if (start < 0) start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end < start) {
    throw new Error(`${action}: expected a JSON body, got HTTP ${status}: ${body.slice(0, 300).replace(/\s+/g, ' ')}`);
  }
  try {
    return JSON.parse(body.slice(start, end + 1)) as AdminJson;
  } catch {
    throw new Error(`${action}: unparseable JSON, HTTP ${status}: ${body.slice(0, 300).replace(/\s+/g, ' ')}`);
  }
}

type FormFields = Record<string, string | number | boolean>;
type MultipartFields = Record<string, string | number | boolean | { name: string; mimeType: string; buffer: Buffer }>;

export interface SeededApplication {
  /** forms_submissions.id */
  id: string;
  name: string;
  email: string;
}

export interface ProgramRound {
  id: string;
  name: string;
  /** "1" = moves and rejects send no email to the applicant */
  silentTransfer: string;
}

export interface FormField {
  /** index of the builder section the field is in */
  section: number;
  key: string;
  name: string;
  type: string;
}

export const ADMIN_PROGRAMS_TABLE = '/table/application_programs';

/**
 * The status tabs above the admin program list (sc-saas-admin themes/default/html/table.php):
 * the `conditions` each tab links to.
 */
export const PROGRAM_LIST_FILTERS = {
  draft: 'status:is_equal_to:0',
  live: 'status:is_equal_to:1,applications_closed:is_equal_to:0,program_closed:is_equal_to:0',
  ongoingEvaluation: 'status:is_equal_to:1,program_closed:is_equal_to:0,applications_closed:is_equal_to:1',
  closed: 'status:is_equal_to:1,program_closed:is_equal_to:1',
} as const;
export type ProgramListFilter = keyof typeof PROGRAM_LIST_FILTERS;

export class CfaAdmin {
  private adminApi?: APIRequestContext;
  private backendApi?: APIRequestContext;

  /** Admin-panel request context on the saved admin session. Created on first use. */
  async api(): Promise<APIRequestContext> {
    if (!this.adminApi) {
      if (!adminAccount('admin')) throw new Error('QA_ADMIN_EMAIL / QA_ADMIN_PASSWORD not set');
      this.adminApi = await playwrightRequest.newContext({ baseURL: env.adminUrl, storageState: authFile('admin') });
    }
    return this.adminApi;
  }

  /** Public backend API of the QA tenant (no auth), e.g. for the program-by-code lookup. */
  async backend(): Promise<APIRequestContext> {
    if (!this.backendApi) {
      this.backendApi = await playwrightRequest.newContext({
        baseURL: env.apiUrl,
        extraHTTPHeaders: { 'x-hostname': new URL(env.frontendUrl).hostname },
      });
    }
    return this.backendApi;
  }

  async dispose() {
    await this.adminApi?.dispose();
    await this.backendApi?.dispose();
    this.adminApi = undefined;
    this.backendApi = undefined;
  }

  private static assertNotRedirected(action: string, pagePath: string, status: number, location?: string) {
    if (status >= 300 && status < 400) {
      throw new Error(
        `${action} on ${pagePath} was redirected to ${location ?? '?'}: the admin session in ${authFile('admin')} ` +
          'has expired (re-run setup-admin), or the page refused access',
      );
    }
  }

  private static assertOk(action: string, json: AdminJson): AdminJson {
    if (json.error === true || json.success !== true) {
      throw new Error(`${action} failed: ${json.errorMessage || json.successMessage || JSON.stringify(json).slice(0, 300)}`);
    }
    return json;
  }

  /**
   * POSTs submitAction=<action> plus `form` to an admin page and returns the parsed JSON.
   * Throws if the response is not JSON, if the session is gone, or if the body says error: true.
   */
  async submitAction(pagePath: string, action: string, form: FormFields = {}): Promise<AdminJson> {
    const api = await this.api();
    const res = await api.post(pagePath, { form: { submitAction: action, ...form }, maxRedirects: 0 });
    CfaAdmin.assertNotRedirected(action, pagePath, res.status(), res.headers()['location']);
    return CfaAdmin.assertOk(action, parseAdminJson(action, res.status(), await res.text()));
  }

  /** Same as submitAction, for handlers that read $_FILES. */
  async submitMultipart(pagePath: string, action: string, multipart: MultipartFields): Promise<AdminJson> {
    const api = await this.api();
    const res = await api.post(pagePath, { multipart: { submitAction: action, ...multipart }, maxRedirects: 0 });
    CfaAdmin.assertNotRedirected(action, pagePath, res.status(), res.headers()['location']);
    return CfaAdmin.assertOk(action, parseAdminJson(action, res.status(), await res.text()));
  }

  /** GETs or POSTs (form) an admin page and returns its HTML. Throws on a login redirect. */
  async html(pagePath: string, form?: FormFields): Promise<string> {
    const api = await this.api();
    const res = form ? await api.post(pagePath, { form, maxRedirects: 0 }) : await api.get(pagePath, { maxRedirects: 0 });
    CfaAdmin.assertNotRedirected('GET', pagePath, res.status(), res.headers()['location']);
    if (!res.ok()) throw new Error(`${pagePath} returned HTTP ${res.status()}`);
    return res.text();
  }

  /**
   * True while the admin wizard still opens the program. program.php redirects to
   * /table/application_programs once the row is gone.
   */
  async programExists(programId: string): Promise<boolean> {
    const api = await this.api();
    const res = await api.get(`/application_management/program/${programId}/edit/x`, { maxRedirects: 0 });
    if (res.status() === 200) return true;
    const location = res.headers()['location'] ?? '';
    if (res.status() >= 300 && res.status() < 400 && /\/table\/application_programs/.test(location)) return false;
    throw new Error(`program ${programId}: unexpected HTTP ${res.status()} ${location} (admin session expired?)`);
  }

  /**
   * Programs whose columns contain `search`, oldest first, one admin table page (10 rows by default).
   * Note: the admin search only does a substring match when the term has none of _ * ? ! % # ^ [..]
   * (Medoo LIKE rule), so search with e.g. "CFA run-", not "[QA] CFA run-".
   */
  async listPrograms(search: string): Promise<{ id: string; title: string }[]> {
    return this.programTableRows(`${ADMIN_PROGRAMS_TABLE}?sortby=id:ASC`, search);
  }

  /**
   * Programs under one of the status tabs above the admin program list (PROGRAM_LIST_FILTERS)
   * whose title contains `titleContains`, from the newest 50 rows of that tab.
   *
   * The admin search can't be combined with the Live and Ongoing Evaluation tabs: table.php puts
   * the search terms into the same OR as those tabs' deadline rule, so a program that matches the
   * search is listed under both tabs whatever its state. And the search is sticky (kept in the PHP
   * session; an empty term keeps the previous one). So for those two tabs a search that matches
   * no program is sent, which leaves only the tab's own rule, and the title is matched here.
   */
  async listProgramsInTab(filter: ProgramListFilter, titleContains: string): Promise<{ id: string; title: string }[]> {
    const search =
      filter === 'live' || filter === 'ongoingEvaluation'
        ? `qa${Math.random().toString(36).slice(2)}nomatch`
        : /* "[QA]" would switch the admin search to exact match (see listPrograms). */
          titleContains.replace(/^\[QA\]\s*/, '');
    const rows = await this.programTableRows(
      `${ADMIN_PROGRAMS_TABLE}?sortby=id:DESC&perpage=50&conditions=${PROGRAM_LIST_FILTERS[filter]}`,
      search,
    );
    return rows.filter((r) => r.title.includes(titleContains));
  }

  private async programTableRows(pagePath: string, search: string): Promise<{ id: string; title: string }[]> {
    const html = await this.html(pagePath, { q: search });
    const rows: { id: string; title: string }[] = [];
    const rowRe = /<tr record_id="(\d+)"[\s\S]*?\/detail\/application_programs\/\1">([^<]*)<\/a>/g;
    for (let m = rowRe.exec(html); m; m = rowRe.exec(html)) {
      rows.push({ id: m[1], title: decodeHtml(m[2]).trim() });
    }
    return rows;
  }

  /** Public backend view of a program by its code (works for test-mode programs). */
  async programByCode(code: string): Promise<{ status: number; data?: Record<string, any> }> {
    const res = await (await this.backend()).get(`/api/v1/application-programs-management/code/${encodeURIComponent(code)}`);
    if (!res.ok()) return { status: res.status() };
    return { status: res.status(), data: (await res.json())?.data };
  }

  /* ----- rounds ----- */

  /**
   * Live rounds of a program (status=1, priority order), as the kanban loads them:
   * getProgramRounds on the submissions page. Deleted rounds are left out.
   */
  async programRounds(program: { id: string; adminSlug: string }): Promise<ProgramRound[]> {
    const json = await this.submitAction(
      `/application_management/submission-application-management/${program.id}/${program.adminSlug}`,
      'getProgramRounds',
      { programID: program.id },
    );
    const rounds = ((json.data as { program_rounds?: Record<string, unknown>[] } | undefined)?.program_rounds ?? []).map((r) => ({
      id: String(r.id),
      name: String(r.round_name ?? ''),
      silentTransfer: String(r.silent_transfer ?? ''),
    }));
    return rounds;
  }

  /** Creates a round (createProgramRound) and returns its id. Throws on error: true. */
  async createRound(program: { id: string; adminSlug: string }, roundTitle: string): Promise<string> {
    const round = await this.submitAction(
      `/application_management/submission-application-management/${program.id}/${program.adminSlug}`,
      'createProgramRound',
      { programId: program.id, roundTitle },
    );
    const roundId = /edit_program_round\/(\d+)/.exec(round.lastRoundUrl ?? '')?.[1];
    if (!roundId) throw new Error(`createProgramRound: no round id in ${round.lastRoundUrl}`);
    return roundId;
  }

  /** Soft-deletes a round (deleteRound: status=0, deleted_at set). */
  async deleteRound(program: { id: string; adminSlug: string }, roundId: string) {
    return this.submitAction(
      `/application_management/submission-application-management/${program.id}/${program.adminSlug}`,
      'deleteRound',
      { roundId },
    );
  }

  /* ----- forms ----- */

  /**
   * The fields of a form, in builder order, read from the form builder page: the builder
   * renders every saved field as addFieldToSection(<section>, "<field JSON>") in its inline
   * script (sc-saas-admin themes/default/html/form-management/edit-form.php). Works for any
   * form id, including the template form; the slug in the URL is not checked.
   */
  async formFields(formId: string): Promise<FormField[]> {
    const html = await this.html(`/form-management/edit-form/${formId}/form`);
    const fields: FormField[] = [];
    const re = /addFieldToSection\((\d+), ("(?:[^"\\]|\\.)*")\);/g;
    for (let m = re.exec(html); m; m = re.exec(html)) {
      const raw = JSON.parse(m[2]) as string;
      const f = JSON.parse(raw) as { key?: string; name?: string; type?: string };
      fields.push({ section: Number(m[1]), key: f.key ?? '', name: f.name ?? '', type: f.type ?? '' });
    }
    return fields;
  }

  /**
   * Restorable versions of a form, newest first: the spa_admin_logs row ids behind the
   * Restore buttons of the builder's "Form Version History" panel. The current version has
   * no Restore button, so it is never in this list.
   */
  async formVersionIds(formId: string): Promise<string[]> {
    const html = await this.html(`/form-management/versions/${formId}`);
    return [...html.matchAll(/recordId="(\d+)"[^>]*restoreFormBtn/g)].map((m) => m[1]);
  }

  /* ----- applications ----- */

  /**
   * Imports draft applications from a CSV (import_applications_csv). Only the five fixed
   * columns are filled; form answers stay empty. Rows land on the drafts page (submitted=0).
   */
  async importApplicationsCsv(program: CfaProgram, rows: { name: string; email: string; companyName: string }[]) {
    const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const lines = [
      ['Name', 'Email', 'Country Code', 'Mobile Number', 'Company Name'],
      ...rows.map((r) => [r.name, r.email, '', '', r.companyName]),
    ].map((cols) => cols.map(csvCell).join(','));
    return this.submitMultipart(
      `/application_management/submission-application-management/${program.id}/${program.adminSlug}`,
      'import_applications_csv',
      { fileToUpload: { name: 'qa-cfa-seed.csv', mimeType: 'text/csv', buffer: Buffer.from(lines.join('\n') + '\n') } },
    );
  }

  /**
   * Draft applications of the program matching `search` (one admin page, newest first).
   * Use a plain alphanumeric search term, see listPrograms.
   */
  async findDrafts(program: CfaProgram, search: string): Promise<{ id: string; email: string }[]> {
    const html = await this.html(`/application_management/draft_applications/${program.id}/${program.adminSlug}`, { q: search });
    return html
      .split('<tr id="applicationsList">')
      .slice(1)
      .map((row) => ({
        id: /applicationid="(\d+)"/i.exec(row)?.[1] ?? '',
        email: (/fa-envelope"><\/i>\s*([^\s<]+)/.exec(row)?.[1] ?? '').toLowerCase(),
      }))
      .filter((r) => r.id);
  }

  /** Moves draft applications to submitted (moveToSubmitted, draft_applications.php). */
  async moveToSubmitted(program: CfaProgram, applicationIds: string[]) {
    const form: FormFields = {};
    applicationIds.forEach((id, i) => (form[`applications[${i}]`] = id));
    return this.submitAction(`/application_management/draft_applications/${program.id}/${program.adminSlug}`, 'moveToSubmitted', form);
  }

  /**
   * Seeds `count` (1-10) submitted applications on `program` with unique names and
   * sc_cfa_<runId>_<tag>_<n> addresses: CSV import, then moveToSubmitted.
   */
  async seedSubmittedApplications(program: CfaProgram, count: number, label = 'seed'): Promise<SeededApplication[]> {
    if (count < 1 || count > 10) throw new Error('seedSubmittedApplications: count must be 1-10 (one admin drafts page)');
    /* Alphanumeric only, so the drafts search does a substring match (see listPrograms). */
    const tag = `${label.replace(/[^a-z0-9]/gi, '').toLowerCase()}${Math.random().toString(36).slice(2, 8)}`;
    const rows = Array.from({ length: count }, (_, i) => ({
      name: `QA ${tag} ${i + 1}`,
      email: cfaEmail(program.runId, `${tag}_${i + 1}`),
      companyName: `QA ${tag} Co ${i + 1}`,
    }));
    await this.importApplicationsCsv(program, rows);

    const drafts = await this.findDrafts(program, tag);
    const byEmail = new Map(drafts.map((d) => [d.email, d.id]));
    const seeded = rows.map((r) => ({ id: byEmail.get(r.email) ?? '', name: r.name, email: r.email }));
    const missing = seeded.filter((s) => !s.id).map((s) => s.email);
    if (missing.length) throw new Error(`imported drafts not found on the drafts page: ${missing.join(', ')}`);

    await this.moveToSubmitted(program, seeded.map((s) => s.id));
    return seeded;
  }
}

function decodeHtml(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/* ---------- Program factory ---------- */

export interface CreateCfaProgramOptions {
  runId: string;
  /** Appended to the title, e.g. "freeze". Leave empty for the per-run program. */
  label?: string;
  /** bypass_otp_verification on the program (guest applicants skip the OTP). Default false. */
  bypassOtp?: boolean;
  /** allow_re_application with re_application_duration_type=immediate. Default true. */
  allowReapplication?: boolean;
  /** Number of rounds, named "[QA] R<n>-<runId>". Default 2. */
  rounds?: number;
  /** Give the last round a rating criterion so jurors can score it (SAN-1498). Default true. */
  ratingCriteriaOnLastRound?: boolean;
  /** Form whose fields are imported. Default QA_CFA_TEMPLATE_FORM_ID. */
  templateFormId?: string;
}

/** A program as createApplicationProgram leaves it: a draft (status 0, test mode off) with an empty form. */
export interface BareCfaProgram {
  id: string;
  adminSlug: string;
  title: string;
  formId: string;
  /** slug of the form-builder URL /form-management/edit-form/{formId}/{formSlug} */
  formSlug: string;
  runId: string;
}

/** Admin wizard URL of a program: step is edit | application_form | finalize. */
export function wizardPath(program: { id: string; adminSlug: string }, step: 'edit' | 'application_form' | 'finalize' = 'edit'): string {
  return `/application_management/program/${program.id}/${step}/${program.adminSlug}`;
}

/** Form-builder URL of a program's own form, as the wizard's application_form step links to it. */
export function formBuilderPath(program: { id: string; formId: string; formSlug?: string }): string {
  return `/form-management/edit-form/${program.formId}/${program.formSlug ?? 'form'}?programId=${program.id}&applicationForms=1`;
}

/**
 * createApplicationProgram (table.php) only: a draft program titled "[QA] CFA run-<runId>[ <label>]",
 * never live and never listed anywhere public. Recorded in .cfa/programs/ for cfa-teardown.
 */
export async function createBareCfaProgram(admin: CfaAdmin, options: { runId: string; label?: string }): Promise<BareCfaProgram> {
  const title = cfaProgramTitle(options.runId, options.label);
  const created = await admin.submitAction(ADMIN_PROGRAMS_TABLE, 'createApplicationProgram', { programName: title });
  const editMatch = /\/application_management\/program\/(\d+)\/edit\/([^/?#"]+)/.exec(created.editUrl ?? '');
  if (!editMatch) throw new Error(`createApplicationProgram: no program id in editUrl ${created.editUrl}`);
  const [, id, adminSlug] = editMatch;
  recordProgram({ id, title, runId: options.runId });
  try {
    const form = await programForm(admin, { id, adminSlug });
    return { id, adminSlug, title, ...form, runId: options.runId };
  } catch (e) {
    await deleteCfaProgram(admin, id).catch(() => undefined);
    throw e;
  }
}

/** The program's own form id, only exposed as the form-builder link on the wizard's application_form step. */
export async function programForm(admin: CfaAdmin, program: { id: string; adminSlug: string }): Promise<{ formId: string; formSlug: string }> {
  const formStep = await admin.html(wizardPath(program, 'application_form'));
  const formMatch = /form-management\/edit-form\/(\d+)\/([^"'?&\s]+)/.exec(formStep);
  if (!formMatch) throw new Error(`program ${program.id}: form-builder link not found on the application_form step`);
  return { formId: formMatch[1], formSlug: formMatch[2] };
}

/** importFieldsFromForm (edit-form.php): replaces the form's fields with the template form's. */
export async function importTemplateFields(admin: CfaAdmin, form: { formId: string; formSlug: string }, templateFormId = env.cfa.templateFormId) {
  if (!templateFormId) throw new Error('QA_CFA_TEMPLATE_FORM_ID not set');
  return admin.submitAction(`/form-management/edit-form/${form.formId}/${form.formSlug}`, 'importFieldsFromForm', {
    formId: form.formId,
    selectedFormId: templateFormId,
  });
}

/**
 * The PWA apply path and backend view of a program. The apply path comes from the wizard's
 * preview iframe (programs/apply/{code}/{slug}, rendered in every wizard state); the backend
 * view from GET application-programs-management/code/{code}, whose `form` is only set once
 * the program's form is published (forms.status=1).
 */
export async function programApplyInfo(
  admin: CfaAdmin,
  program: { id: string; adminSlug: string },
): Promise<{ code: string; slug: string; backend: { status: number; data?: Record<string, any> } }> {
  const wizardHtml = await admin.html(wizardPath(program));
  const applyMatch = /programs\/apply\/([^/"'?\s]+)\/([^"'?\s<]+)/.exec(wizardHtml);
  if (!applyMatch) throw new Error(`program ${program.id}: apply link not found on the wizard`);
  const [, code, slug] = applyMatch;
  return { code, slug, backend: await admin.programByCode(code) };
}

/**
 * Creates a test-mode, live CFA program:
 *   createApplicationProgram → importFieldsFromForm (template form) → editProgram →
 *   createProgramRound × n (+ rating criteria on the last) → changeTestMode enable → makeProgramLive.
 * Test mode is switched on BEFORE the program goes live, so it is never publicly listed.
 * The program is recorded in .cfa/programs/ so cfa-teardown deletes it even if the test
 * that made it crashes. Never use it for Jury NDA: NDA rows make deleteApplicationProgram refuse.
 */
export async function createCfaProgram(admin: CfaAdmin, options: CreateCfaProgramOptions): Promise<CfaProgram> {
  const {
    runId,
    label,
    bypassOtp = false,
    allowReapplication = true,
    rounds = 2,
    ratingCriteriaOnLastRound = true,
    templateFormId = env.cfa.templateFormId,
  } = options;
  if (!templateFormId) throw new Error('QA_CFA_TEMPLATE_FORM_ID not set');

  const bare = await createBareCfaProgram(admin, { runId, label });
  const { id, adminSlug, title, formId } = bare;

  try {
    const wizard = wizardPath(bare);

    await importTemplateFields(admin, bare, templateFormId);

    await admin.submitAction(wizard, 'editProgram', editProgramForm({ title, runId, bypassOtp, allowReapplication }));

    const roundIds: string[] = [];
    for (let n = 1; n <= rounds; n++) {
      roundIds.push(await admin.createRound(bare, `[QA] R${n}-${runId}`));
    }
    if (ratingCriteriaOnLastRound && roundIds.length) {
      const last = roundIds[roundIds.length - 1];
      await admin.submitAction(`/application_management/edit_program_round/${last}`, 'update_rating_criteria', {
        programId: id,
        roundId: last,
        ratings_data: JSON.stringify([{ criteriaId: '', criteriaTitle: '[QA] Overall', criteriaDescription: 'E2E criterion' }]),
      });
    }

    /* changeTestMode enable also sets status=1; makeProgramLive then publishes the form (forms.status=1). */
    await admin.submitAction(wizard, 'changeTestMode', { action: 'enable', programId: id });
    await admin.submitAction(wizard, 'makeProgramLive', { programId: id });

    const { code, slug, backend } = await programApplyInfo(admin, bare);
    const data = backend.data;
    if (!data?.uuid || !data?.form?.uuid) {
      throw new Error(`program ${id}: backend GET application-programs-management/code/${code} returned ${backend.status} without uuid/form`);
    }
    if (data.testModeEnabled !== true || data.status !== true) {
      throw new Error(`program ${id}: expected test mode on and live, backend says testModeEnabled=${data.testModeEnabled} status=${data.status}`);
    }

    return { id, uuid: data.uuid, code, slug, adminSlug, title, formId, formUUID: data.form.uuid, roundIds, runId };
  } catch (e) {
    /* Never leave a half-built program behind. */
    await deleteCfaProgram(admin, id).catch(() => undefined);
    throw e;
  }
}

/**
 * The editProgram POST body. editProgram (program.php) reads every one of these keys without
 * isset(), so all are sent; `overrides` replaces individual keys.
 */
export function editProgramForm(
  input: { title: string; runId: string; bypassOtp?: boolean; allowReapplication?: boolean },
  overrides: Record<string, string> = {},
): Record<string, string> {
  const { title, runId, bypassOtp = false, allowReapplication = true } = input;
  return {
    program_title: title,
    short_description: `Automated E2E program for run ${runId}. Safe to delete.`,
    description: '',
    application_closed_date: '',
    allow_re_application: allowReapplication ? '1' : '0',
    re_application_duration_type: allowReapplication ? 'immediate' : '',
    re_application_duration: '',
    mobile_number_field: '0',
    is_pitch_document_required: '0',
    company_name_field: '0',
    bypass_otp_verification: bypassOtp ? '1' : '0',
    is_video_required: '0',
    is_document_required: '0',
    is_payment_required: '0',
    membership_stakeholder_type: '',
    content_sections: '[]',
    faq_sections: '[]',
    ...overrides,
  };
}

/** Deletes a program (deleteApplicationProgram) and checks the admin wizard no longer opens it. */
export async function deleteCfaProgram(admin: CfaAdmin, programId: string): Promise<void> {
  await admin.submitAction(ADMIN_PROGRAMS_TABLE, 'deleteApplicationProgram', { programId });
  if (await admin.programExists(programId)) {
    throw new Error(`deleteApplicationProgram reported success but program ${programId} still opens`);
  }
  forgetProgram(programId);
}

/** Deletes every program titled "[QA] CFA run-<runId>..." (the run program and its throwaways). */
export async function deleteRunPrograms(admin: CfaAdmin, runId: string): Promise<string[]> {
  const deleted: string[] = [];
  for (let page = 0; page < 20; page++) {
    const mine = (await admin.listPrograms(`CFA run-${runId}`)).filter((p) => runIdFromTitle(p.title) === runId);
    if (!mine.length) break;
    for (const p of mine) {
      await deleteCfaProgram(admin, p.id);
      deleted.push(p.id);
    }
  }
  return deleted;
}

/**
 * Orphan sweep: deletes "[QA] CFA run-<runId>..." programs whose run started more than
 * `maxAgeMs` ago (crashed runs). Age comes from the run id in the title, because the admin
 * program list shows no creation date. Titles that don't carry a run id are never touched.
 */
export async function sweepOrphanPrograms(admin: CfaAdmin, now = new Date(), maxAgeMs = 24 * 60 * 60 * 1000): Promise<string[]> {
  const deleted: string[] = [];
  for (let page = 0; page < 20; page++) {
    const stale = (await admin.listPrograms('CFA run-')).filter((p) => {
      const runId = runIdFromTitle(p.title);
      const started = runId ? runStartedAt(runId) : null;
      return !!started && now.getTime() - started.getTime() > maxAgeMs;
    });
    if (!stale.length) break;
    for (const p of stale) {
      await deleteCfaProgram(admin, p.id);
      deleted.push(p.id);
    }
  }
  return deleted;
}

/* ---------- Test fixtures ---------- */

type CfaWorkerFixtures = {
  /** Contents of .cfa/run.json, written by cfa-setup. */
  cfaRun: CfaRun;
  /** Admin submitAction client on the saved admin session. */
  cfaAdmin: CfaAdmin;
};

type CfaTestFixtures = {
  /** The per-run test-mode program. */
  cfaProgram: CfaProgram;
  /** CFA flag values read once by cfa-setup. Skip with test.skip(!cfaFlags.x, '<x> is off on this tenant'). */
  cfaFlags: CfaFlags;
  /** Skips every CFA test when cfa-setup recorded a skip reason (missing secret, CFA off). */
  cfaGate: void;
  /** A page in its own browser context on the saved admin session, baseURL = ADMIN_URL. */
  adminPage: Page;
};

/**
 * `test` for tests/cfa/**. Every test is skipped, with cfa-setup's reason, when the run
 * could not be set up; a missing .cfa/run.json (cfa-setup never ran) fails loudly instead.
 */
export const test = base.extend<CfaTestFixtures, CfaWorkerFixtures>({
  cfaRun: [
    async ({}, use) => {
      const run = readCfaRun();
      if (!run) throw new Error(`${CFA_RUN_FILE} is missing: run the cfa project with its dependencies (cfa-setup), not --no-deps`);
      await use(run);
    },
    { scope: 'worker' },
  ],
  cfaAdmin: [
    async ({}, use) => {
      const admin = new CfaAdmin();
      await use(admin);
      await admin.dispose();
    },
    { scope: 'worker' },
  ],
  cfaGate: [
    async ({ cfaRun }, use) => {
      base.skip(!!cfaRun.skipReason, cfaRun.skipReason);
      await use();
    },
    { auto: true },
  ],
  cfaProgram: async ({ cfaRun }, use) => {
    if (!cfaRun.program) throw new Error('cfa-setup recorded no program');
    await use(cfaRun.program);
  },
  cfaFlags: async ({ cfaRun }, use) => {
    if (!cfaRun.flags) throw new Error('cfa-setup recorded no flags');
    await use(cfaRun.flags);
  },
  adminPage: async ({ browser }, use) => {
    const context = await browser.newContext({ storageState: authFile('admin'), baseURL: env.adminUrl });
    try {
      await use(await context.newPage());
    } finally {
      await context.close();
    }
  },
});

export { expect } from '@playwright/test';
