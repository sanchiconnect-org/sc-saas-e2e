/**
 * SAN-1959 (SAN-2001): a call-for-applications guest proves their email before the backend acts for them.
 * Owner: Nirmal Singh
 * Pass bar: the OTP verify issues an applicant token only when it names the program; the token reads its
 * own applicant's status; with APPLICANT_TOKEN_MODE=enforce a missing, tampered, other-applicant,
 * other-program or other-submission token is refused (401/403 with the error code); an applicant token is
 * never a member login; update-document never accepts or rejects a document (400 in every mode);
 * 5 wrong OTP codes lock that code; the admin "view as applicant" link opens the application with a token.
 *
 * Mode handling (explicit, so the suite is green in both phases of the rollout):
 *   detectApplicantTokenMode() probes the backend once (a tokenless status call: 401 APPLICANT_TOKEN_REQUIRED
 *   means enforce). In 'enforce' every refusal below is asserted with its status and code. In 'log-or-off'
 *   the same requests must still be ANSWERED (2xx): that is the log-mode contract (refusals are only logged),
 *   not a skip. Checks that hold in every mode (token issue, the member-login check, the document status
 *   rule, the OTP lock, the admin link) run the same either way. Set QA_EXPECT_APPLICANT_TOKEN_MODE=enforce
 *   for the run after development is flipped, so a missed flip fails instead of passing in log mode.
 *
 * Applicants are CSV-seeded on a throwaway program (deleted in afterAll; cfa-teardown deletes it after a
 * crash). Tokens come from the QA fixed OTP, so QA_CFA_EMAIL_PATTERN must be on the backend's
 * QA_FIXED_OTP_EMAILS. OTP routes allow 10 requests per 60 s: the helpers wait once on a 429.
 */
import * as fs from 'fs';
import { authFile, memberAccount, qaOtp } from '../../config/accounts';
import { env } from '../../config/env';
import {
  backendCall,
  applicantHeaders,
  sendEmailOtp,
  verifyEmailOtp,
  type BackendResult,
} from '../../fixtures/applicant-token';
import {
  APPLICANT_TOKEN_HEADER,
  applicantToken,
  cfaEmail,
  createCfaProgram,
  decodeApplicantToken,
  deleteCfaProgram,
  detectApplicantTokenMode,
  expect,
  expectedApplicantTokenMode,
  test,
  type ApplicantTokenMode,
  type CfaProgram,
  type SeededApplication,
} from '../../fixtures/cfa';
import { memberApi } from '../../fixtures/memberApi';
import { ApplicationStatusPage } from '../../pages/frontend/cfa/ApplicationStatusPage';
import { ProgramApplyPage } from '../../pages/frontend/cfa/ProgramApplyPage';
import { rand } from './p3-helpers';

const TAGS = ['@regression', '@cfa', '@frontend', '@write'];

/** A status code and the backend's error `code` (top level of the error body). */
type Outcome = { status: number; code?: string };
const outcome = (r: BackendResult): Outcome => ({ status: r.status, code: r.json?.code });

test.describe('SAN-1959: applicant token on the public call-for-applications routes', { tag: TAGS }, () => {
  test.describe.configure({ mode: 'serial' });

  let program: CfaProgram;
  let a: SeededApplication;
  let b: SeededApplication;
  let mode: ApplicantTokenMode;

  test.beforeAll(async ({ cfaAdmin, cfaRun }) => {
    test.setTimeout(180_000);
    test.skip(!!cfaRun.skipReason, cfaRun.skipReason);
    test.skip(!env.cfa.emailPattern, 'QA_CFA_EMAIL_PATTERN not set: applicant tokens come from the fixed OTP for CFA guest addresses');
    program = await createCfaProgram(cfaAdmin, { runId: cfaRun.runId, label: `aptoken-${rand()}`, rounds: 1, ratingCriteriaOnLastRound: false });
    [a, b] = await cfaAdmin.seedSubmittedApplications(program, 2, 'aptok');
    mode = await detectApplicantTokenMode(program.uuid);
  });

  test.afterAll(async ({ cfaAdmin }) => {
    if (program) await deleteCfaProgram(cfaAdmin, program.id);
  });

  test.beforeEach(() => {
    test.info().annotations.push({ type: 'APPLICANT_TOKEN_MODE', description: mode });
  });

  /**
   * A request the backend refuses in enforce. In enforce: exactly `refusal` (status + code). In log/off:
   * answered as before (2xx), because log mode only writes a log line.
   */
  function expectGuarded(actual: Outcome, refusal: Required<Outcome>, what: string) {
    if (mode === 'enforce') {
      expect(actual, `${what} (enforce)`).toEqual(refusal);
    } else {
      expect(actual.status, `${what} (APPLICANT_TOKEN_MODE log/off: answered, only logged)`).toBeLessThan(300);
    }
  }

  test('the run is in the APPLICANT_TOKEN_MODE it expects (QA_EXPECT_APPLICANT_TOKEN_MODE)', async () => {
    const expected = expectedApplicantTokenMode();
    test.skip(!expected, `QA_EXPECT_APPLICANT_TOKEN_MODE not set; detected ${mode}`);
    expect(mode, 'APPLICANT_TOKEN_MODE detected on the backend').toBe(expected);
  });

  test('verify issues an email-scoped token only when it names the program', async () => {
    test.setTimeout(150_000);
    /* Without applicantProgramUUID the verify response is unchanged: no token. */
    const plain = cfaEmail(program.runId, `aptokplain_${rand()}`);
    expect((await sendEmailOtp(plain)).status, 'send').toBeLessThan(400);
    const unscoped = await verifyEmailOtp(plain, qaOtp());
    expect(unscoped.status, JSON.stringify(unscoped.json)).toBeLessThan(300);
    expect(unscoped.json?.data).toMatchObject({ verified: true });
    expect(unscoped.json?.data?.applicantToken, 'no token without applicantProgramUUID').toBeUndefined();

    /* With it: an email-scoped token for that program, 120 minutes. */
    const issued = await applicantToken(program.uuid, a.email, { fresh: true });
    const claims = decodeApplicantToken(issued.applicantToken);
    expect(claims).toMatchObject({ typ: 'cfa_applicant', email: a.email.toLowerCase(), programUUID: program.uuid });
    expect(claims.sid, 'email-scoped: no sid').toBeUndefined();
    expect(claims.exp - claims.iat).toBe(120 * 60);
    expect(Date.parse(issued.applicantTokenExpiresAt)).toBe(claims.exp * 1000);
  });

  test("the applicant's own token reads their status (every mode)", async ({ cfaAdmin }) => {
    const own = await cfaAdmin.applicationStatus(program.uuid, a.email);
    /* the route is a POST, so Nest answers 201 */
    expect(own.status, JSON.stringify(own.body)).toBeGreaterThanOrEqual(200);
    expect(own.status, JSON.stringify(own.body)).toBeLessThan(300);
    expect(Number(own.data?.submissionId)).toBe(Number(a.id));
  });

  test('no token, or a tampered one: 401 APPLICANT_TOKEN_REQUIRED', async ({ cfaAdmin }) => {
    const none = await cfaAdmin.applicationStatus(program.uuid, a.email, { token: null });
    expectGuarded({ status: none.status, code: none.body?.code }, { status: 401, code: 'APPLICANT_TOKEN_REQUIRED' }, 'status without a token');

    const valid = (await applicantToken(program.uuid, a.email)).applicantToken;
    /* Change the signature's first character: every bit of it counts (the last one carries padding bits). */
    const [head, body, sig] = valid.split('.');
    const tampered = `${head}.${body}.${sig[0] === 'A' ? 'B' : 'A'}${sig.slice(1)}`;
    const bad = await cfaAdmin.applicationStatus(program.uuid, a.email, { token: tampered });
    expectGuarded({ status: bad.status, code: bad.body?.code }, { status: 401, code: 'APPLICANT_TOKEN_REQUIRED' }, 'status with a tampered token');
  });

  test("another applicant's token: 403 APPLICANT_NOT_OWNER", async ({ cfaAdmin }) => {
    const tokenA = (await applicantToken(program.uuid, a.email)).applicantToken;
    const res = await cfaAdmin.applicationStatus(program.uuid, b.email, { token: tokenA });
    expectGuarded({ status: res.status, code: res.body?.code }, { status: 403, code: 'APPLICANT_NOT_OWNER' }, "A's token on B's status");
  });

  test('a token for another program: 403 APPLICANT_NOT_OWNER', async ({ cfaAdmin, cfaProgram }) => {
    test.setTimeout(150_000);
    /* Same email, but proven for the run's program, not this one. */
    const otherProgram = (await applicantToken(cfaProgram.uuid, a.email)).applicantToken;
    const res = await cfaAdmin.applicationStatus(program.uuid, a.email, { token: otherProgram });
    expectGuarded({ status: res.status, code: res.body?.code }, { status: 403, code: 'APPLICANT_NOT_OWNER' }, 'a token for the run program on this program');
  });

  test('an applicant token is never a member login (401 on a JwtAuthGuard route, every mode)', async () => {
    const token = (await applicantToken(program.uuid, a.email)).applicantToken;
    const asBearer = await backendCall('GET', 'users/profile', { headers: { authorization: `Bearer ${token}` } });
    expect(asBearer.status, 'as Bearer').toBe(401);
    const asCookie = await backendCall('GET', 'users/profile', { headers: { cookie: `accessToken=${token}` } });
    expect(asCookie.status, 'as the accessToken cookie').toBe(401);
  });

  test("My Applications (applied/{email}) takes the member's own JWT only", async () => {
    const startup = memberAccount('startup');
    test.skip(!startup || !fs.existsSync(authFile('startup')), 'QA_STARTUP_EMAIL not set, or no saved startup session');
    const path = `application-programs-management/applied/${encodeURIComponent(startup!.email)}`;
    /* The saved session's JWT as Bearer: no new login (single-session rule). */
    const member = await memberApi('startup', 'POST', path);
    expect(member.status, `member JWT: ${JSON.stringify(member.json).slice(0, 200)}`).toBeLessThan(300);

    expectGuarded(outcome(await backendCall('POST', path)), { status: 401, code: 'APPLICANT_TOKEN_REQUIRED' }, 'applied/{email} anonymous');
    const tokenA = (await applicantToken(program.uuid, a.email)).applicantToken;
    const withApplicantToken = await backendCall('POST', `application-programs-management/applied/${encodeURIComponent(a.email)}`, { headers: applicantHeaders(tokenA) });
    expectGuarded(outcome(withApplicantToken), { status: 403, code: 'APPLICANT_NOT_OWNER' }, 'applied/{email} with an applicant token');
  });

  test("documents: update-document never sets 'accepted' (400 every mode); other applicants are refused", async ({ cfaAdmin }) => {
    test.setTimeout(150_000);
    const [roundId] = program.roundIds;
    const docName = `QA aptok doc ${rand()}`;
    await cfaAdmin.addRoundDocumentType(program, roundId, docName);
    const tokenA = (await applicantToken(program.uuid, a.email)).applicantToken;
    const tokenB = (await applicantToken(program.uuid, b.email)).applicantToken;
    const asA = applicantHeaders(tokenA);
    const fetchPath = `application-programs-management/fetch-documents/${program.id}/${a.id}/${roundId}`;

    const listed = await backendCall('GET', fetchPath, { headers: asA });
    expect(listed.status, JSON.stringify(listed.json).slice(0, 300)).toBe(200);
    const type = (listed.json?.data?.documents ?? []).find((d: { name?: string }) => d.name === docName);
    expect(type?.id, `document type "${docName}" listed for the round`).toBeTruthy();
    expectGuarded(outcome(await backendCall('GET', fetchPath)), { status: 401, code: 'APPLICANT_TOKEN_REQUIRED' }, 'fetch-documents without a token');
    expectGuarded(outcome(await backendCall('GET', fetchPath, { headers: applicantHeaders(tokenB) })), { status: 403, code: 'APPLICANT_NOT_OWNER' }, "fetch-documents of A with B's token");

    const submitted = await backendCall('POST', 'application-programs-management/submit-document', {
      headers: asA,
      body: {
        documentTypeId: Number(type.id),
        programId: Number(program.id),
        programRoundId: Number(roundId),
        submissionId: Number(a.id),
        fileName: 'qa-aptok.pdf',
        attachment: 'https://example.invalid/qa-aptok.pdf',
      },
    });
    expect(submitted.status, JSON.stringify(submitted.json).slice(0, 300)).toBeLessThan(300);
    const docId = submitted.json?.data?.id;
    expect(docId, 'submit-document returns the document').toBeTruthy();
    const updatePath = `application-programs-management/update-document/${docId}`;

    const accepted = await backendCall('PUT', updatePath, { headers: asA, body: { approvalStatus: 'accepted' } });
    expect(accepted.status, "the applicant's own token cannot accept a document").toBe(400);
    const rejected = await backendCall('PUT', updatePath, { headers: asA, body: { approvalStatus: 'rejected' } });
    expect(rejected.status, "the applicant's own token cannot reject a document").toBe(400);
    /* Without a credential the guard answers first in enforce (401); in log the status rule still refuses (400). */
    const anonymous = outcome(await backendCall('PUT', updatePath, { body: { approvalStatus: 'accepted' } }));
    expect(anonymous, 'tokenless accept').toEqual(mode === 'enforce' ? { status: 401, code: 'APPLICANT_TOKEN_REQUIRED' } : expect.objectContaining({ status: 400 }));

    const resubmitted = await backendCall('PUT', updatePath, { headers: asA, body: { approvalStatus: 'submitted', fileName: 'qa-aptok-2.pdf' } });
    expect(resubmitted.status, "'submitted' is the applicant's own re-upload").toBeLessThan(300);
    expectGuarded(
      outcome(await backendCall('PUT', updatePath, { headers: applicantHeaders(tokenB), body: { approvalStatus: 'submitted' } })),
      { status: 403, code: 'APPLICANT_NOT_OWNER' },
      "update-document of A's document with B's token",
    );

    const after = await backendCall('GET', fetchPath, { headers: asA });
    const doc = (after.json?.data?.documents ?? []).find((d: { name?: string }) => d.name === docName);
    expect(doc?.submission?.approvalStatus, 'the document is still only submitted').toBe('submitted');
  });

  test('5 wrong codes lock the OTP: the right code is refused afterwards, and no token is issued', async () => {
    test.setTimeout(150_000);
    /* A fresh per-run address (never a seeded or shared account). It matches QA_CFA_EMAIL_PATTERN only so
       that the right code is known (the fixed OTP) and "right code after the lock" can be checked. */
    const email = cfaEmail(program.runId, `aptoklock_${rand()}`);
    const right = qaOtp();
    const wrong = right === '9999' ? '8888' : '9999';
    expect((await sendEmailOtp(email)).status, 'send').toBeLessThan(400);
    for (let attempt = 1; attempt <= 4; attempt++) {
      const res = await verifyEmailOtp(email, wrong, program.uuid);
      expect(outcome(res), `wrong code #${attempt}`).toEqual({ status: 409, code: undefined });
    }
    expect(outcome(await verifyEmailOtp(email, wrong, program.uuid)), 'wrong code #5 locks it').toEqual({ status: 409, code: 'OTP_TOO_MANY_ATTEMPTS' });
    const late = await verifyEmailOtp(email, right, program.uuid);
    expect(outcome(late), 'the right code after the lock').toEqual({ status: 409, code: 'OTP_TOO_MANY_ATTEMPTS' });
    expect(late.json?.data?.applicantToken, 'no token from a locked code').toBeUndefined();
  });

  test('admin "view as applicant" opens the application with a token for that one submission', { tag: '@admin' }, async ({ cfaAdmin, page }) => {
    const redirect = await cfaAdmin.viewAsApplicantRedirect(a.id);
    test.skip(redirect.status === 403, 'the QA admin has no backdoor_access, so view_as_applicant refuses (by design)');
    expect(redirect.status, `view_as_applicant → ${redirect.location}`).toBe(302);
    const target = new URL(redirect.location!);
    expect(target.origin).toBe(new URL(env.frontendUrl).origin);
    expect(target.pathname).toMatch(new RegExp(`^/programs/apply/${program.code}/`));
    expect(target.searchParams.get('isBackdoor')).toBe('true');
    expect(target.searchParams.get('applicationEmail')?.toLowerCase()).toBe(a.email.toLowerCase());
    expect(target.search, 'the token is never in the query string').not.toContain('applicantToken');
    const token = new URLSearchParams(target.hash.replace(/^#/, '')).get('applicantToken');
    expect(token, 'token in the URL fragment').toBeTruthy();
    expect(decodeApplicantToken(token!)).toMatchObject({ programUUID: program.uuid, sid: Number(a.id), src: 'admin' });

    const apply = new ProgramApplyPage(page);
    const status = new ApplicationStatusPage(page);
    const detailsResponse = status.waitForDetails(program.uuid);
    await page.goto(redirect.location!);
    const details = await detailsResponse;
    expect((await details.request().allHeaders())[APPLICANT_TOKEN_HEADER], 'the status call carries the admin-minted token').toBe(token);
    expect(Number((await ApplicationStatusPage.details(details)).submissionId)).toBe(Number(a.id));
    expect(page.url(), 'the fragment is removed from the address bar').not.toContain('applicantToken');
    expect((await apply.storedApplicantToken(program.uuid))?.token).toBe(token);

    /* That sid token is for submission A only. */
    const onB = await cfaAdmin.applicationStatus(program.uuid, b.email, { token });
    expectGuarded({ status: onB.status, code: onB.body?.code }, { status: 403, code: 'APPLICANT_NOT_OWNER' }, "the admin sid token for A on B's status");
  });
});
