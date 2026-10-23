import { createHash } from 'crypto';
import { test } from '@playwright/test';
import { qaOtp } from '../config/accounts';
import { env } from '../config/env';

/**
 * SAN-1959 applicant token: how a call-for-applications guest proves their email to the backend.
 *
 * The backend (sc-saas-backend, SAN-1999) issues it from POST public/otp_verifications/verify when the
 * body names `applicantProgramUUID` and the email OTP is right. The PWA keeps it in
 * localStorage['applicant-token-<programUUID>'] = { token, expiresAt } and sends it as the
 * `x-applicant-token` header on the 21 applicant routes (status, documents, guest form fetch/submit/upload,
 * apply, payments, PowerPitch connect). A logged-in member needs none: their own cookie/Bearer JWT is
 * accepted on their own applications.
 *
 * Two kinds:
 *  - email-scoped (from verify): { email, programUUID }, any application of that email in that program;
 *  - submission-scoped: adds `sid` (one forms_submissions id) and `src`: 'created' on a bypass-OTP
 *    program's first form save, 'admin' from the admin "view as applicant" link.
 * Both live 120 minutes, so one token per (program, email) covers a whole run.
 *
 * Enforcement is staged by the backend env APPLICANT_TOKEN_MODE (off | log | enforce, default log).
 * In log mode a request without a matching credential is still answered, so the suite has to send the
 * token BEFORE dev is flipped to enforce, and the negative tests must know which mode they are in:
 * see detectApplicantTokenMode().
 *
 * Every token here comes from the QA fixed OTP (SAN-1864): the address must match the QA backend's
 * QA_FIXED_OTP_EMAILS. Per-run CFA applicants are built from QA_CFA_EMAIL_PATTERN (cfaEmail), which must
 * be on that list; the seeded member addresses already are. Those addresses are also exempt from the
 * backend's 5-codes-per-email-per-hour send limit (OTP_SEND_LIMIT), so the suite never locks itself out.
 */

export const APPLICANT_TOKEN_HEADER = 'x-applicant-token';

/** The localStorage key the PWA keeps a program's applicant token under (sc-saas-frontend applicant-token.service.ts). */
export const applicantTokenStorageKey = (programUuid: string) => `applicant-token-${programUuid}`;

/** What verify (and a bypass-OTP first save) adds to its response data. */
export interface IssuedApplicantToken {
  applicantToken: string;
  /** ISO time, issue time + 120 min */
  applicantTokenExpiresAt: string;
}

/** The token's claims (sc-saas-backend core/services/applicant-token.service.ts). Read only, never verified here. */
export interface ApplicantTokenClaims {
  typ: string;
  email: string;
  programUUID: string;
  sid?: number;
  src?: 'created' | 'admin';
  adminId?: number;
  aud: string;
  iat: number;
  exp: number;
  jti: string;
}

/** Decodes a token's payload (no signature check: the backend is the only verifier). */
export function decodeApplicantToken(token: string): ApplicantTokenClaims {
  const payload = token.split('.')[1];
  if (!payload) throw new Error('not a JWT');
  return JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
}

/** The OTP wire format: the PWA, the seed and the backend all use md5(code) (knowledge.md §1). */
export const otpHash = (code: string) => createHash('md5').update(code).digest('hex');

/* ---------- Plain backend calls (no browser) ---------- */

export interface BackendResult {
  status: number;
  /** The parsed body: { status_code, message, data } on success, { status_code, message, error, code? } on error. */
  json: Record<string, any> | undefined;
}

/**
 * One call to the QA tenant backend, as the PWA makes it (x-hostname = the PWA host). `headers` adds e.g.
 * x-applicant-token or authorization. Never throws on an HTTP error status: the caller asserts on it.
 */
export async function backendCall(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  options: { body?: unknown; headers?: Record<string, string> } = {},
): Promise<BackendResult> {
  const res = await fetch(`${env.apiUrl}/api/v1/${path.replace(/^\//, '')}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-hostname': new URL(env.frontendUrl).hostname,
      ...options.headers,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await res.text();
  let json: Record<string, any> | undefined;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = { raw: text.slice(0, 300) };
  }
  return { status: res.status, json };
}

/** Headers that carry an applicant token, or none for null/undefined. */
export function applicantHeaders(token: string | null | undefined): Record<string, string> {
  return token ? { [APPLICANT_TOKEN_HEADER]: token } : {};
}

/** Gives the running test (or hook) more time; a no-op outside one. */
function extendTimeout(ms: number) {
  try {
    const info = test.info();
    info.setTimeout(info.timeout + ms);
  } catch {
    /* not inside a test */
  }
}

/**
 * The OTP routes allow 10 requests per 60 s per client (RateLimiterGuard). On that 429 this waits the
 * window out and repeats the call once, like LoginPage.requestOtp. The per-email send limit is also a 429
 * but carries code OTP_SEND_LIMIT: waiting a minute does not lift it, so it is returned as is.
 */
async function withRateLimitBackoff(call: () => Promise<BackendResult>): Promise<BackendResult> {
  const first = await call();
  if (first.status !== 429 || first.json?.code === 'OTP_SEND_LIMIT') return first;
  extendTimeout(75_000);
  await new Promise((resolve) => setTimeout(resolve, 61_000));
  return call();
}

/** POST public/otp_verifications/send for an email (backs off once on the rate limit). */
export function sendEmailOtp(email: string, name = 'QA applicant'): Promise<BackendResult> {
  return withRateLimitBackoff(() =>
    backendCall('POST', 'public/otp_verifications/send', { body: { type: 'email', emailAddress: email, name } }),
  );
}

/**
 * POST public/otp_verifications/verify with md5(code). With `applicantProgramUUID` and a right code the
 * response data carries applicantToken + applicantTokenExpiresAt (backs off once on the rate limit).
 */
export function verifyEmailOtp(email: string, code: string, applicantProgramUUID?: string): Promise<BackendResult> {
  return withRateLimitBackoff(() =>
    backendCall('POST', 'public/otp_verifications/verify', {
      body: { type: 'email', emailAddress: email, code: otpHash(code), ...(applicantProgramUUID ? { applicantProgramUUID } : {}) },
    }),
  );
}

/* ---------- Tokens via the fixed OTP ---------- */

/* One token per (program, email) per worker. 120 min outlives a run; re-issued 5 min before expiry. */
const cache = new Map<string, IssuedApplicantToken>();
const REFRESH_BEFORE_MS = 5 * 60 * 1000;

/**
 * An email-scoped applicant token for `email` on `programUuid`, obtained the way a guest gets one:
 * send the email OTP, then verify the QA fixed OTP with applicantProgramUUID. Cached per worker.
 * Throws with the reason when the backend issues none: the address is not on QA_FIXED_OTP_EMAILS,
 * the per-email send limit hit, or the backend predates SAN-1959.
 */
export async function applicantToken(programUuid: string, email: string, options: { fresh?: boolean } = {}): Promise<IssuedApplicantToken> {
  const key = `${programUuid}|${email.trim().toLowerCase()}`;
  const cached = cache.get(key);
  if (!options.fresh && cached && Date.parse(cached.applicantTokenExpiresAt) - REFRESH_BEFORE_MS > Date.now()) return cached;

  /* A concurrent send for the same address (another worker) can complete the newest OTP row first
     (409 "already expired or completed"); a second send + verify then gets a row of its own. */
  let verified: BackendResult | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const sent = await sendEmailOtp(email);
    if (sent.status === 429 && sent.json?.code === 'OTP_SEND_LIMIT') {
      throw new Error(
        'otp_verifications/send for a QA applicant answered 429 OTP_SEND_LIMIT: QA_FIXED_OTP_EMAILS addresses are exempt ' +
          'from the per-email send limit (SAN-1959), so this address is not on the QA backend\'s QA_FIXED_OTP_EMAILS',
      );
    }
    if (sent.status >= 400) throw new Error(`otp_verifications/send: HTTP ${sent.status} ${JSON.stringify(sent.json)}`);
    verified = await verifyEmailOtp(email, qaOtp(), programUuid);
    if (!(verified.status === 409 && /already expired or completed/i.test(JSON.stringify(verified.json ?? {})))) break;
  }
  if (verified!.status === 409 && /Invalid one time password/i.test(JSON.stringify(verified!.json ?? {}))) {
    throw new Error(
      'the QA backend does not issue the fixed OTP for this applicant address: add QA_CFA_EMAIL_PATTERN (and the member addresses) ' +
        'to its QA_FIXED_OTP_EMAILS (FT-006 D4). SAN-1959 needs it: guest calls carry an applicant token from the OTP.',
    );
  }
  if (verified!.status >= 400) throw new Error(`otp_verifications/verify: HTTP ${verified!.status} ${JSON.stringify(verified!.json)}`);
  const data = verified!.json?.data ?? {};
  if (typeof data.applicantToken !== 'string' || !data.applicantToken) {
    throw new Error('otp_verifications/verify returned no applicantToken: the backend on this environment predates SAN-1959 (SAN-1999)');
  }
  const issued: IssuedApplicantToken = { applicantToken: data.applicantToken, applicantTokenExpiresAt: String(data.applicantTokenExpiresAt) };
  cache.set(key, issued);
  return issued;
}

/* ---------- Enforcement mode ---------- */

/**
 * What the suite can see of the backend's APPLICANT_TOKEN_MODE:
 *  - 'enforce': a request without a credential is refused (401 APPLICANT_TOKEN_REQUIRED);
 *  - 'log-or-off': it is answered as before. 'log' and 'off' look the same from outside (the
 *    difference is a pm2 log line), and both are fine for the suite.
 */
export type ApplicantTokenMode = 'enforce' | 'log-or-off';

const modeCache = new Map<string, ApplicantTokenMode>();

/**
 * Detects the mode with one tokenless probe: POST check_application_status/{email}/details on an existing
 * program for an address that never applied. enforce answers 401 { code: APPLICANT_TOKEN_REQUIRED }
 * (no credential is refused before the lookup); log/off let it through, and the service answers 404
 * (no application). Anything else is a product change the suite should hear about, so it throws.
 */
export async function detectApplicantTokenMode(programUuid: string): Promise<ApplicantTokenMode> {
  const known = modeCache.get(programUuid);
  if (known) return known;
  const probeEmail = `qa_mode_probe_${Math.random().toString(36).slice(2, 10)}@example.invalid`;
  const res = await backendCall(
    'POST',
    `application-programs-management/${programUuid}/check_application_status/${encodeURIComponent(probeEmail)}/details`,
  );
  let mode: ApplicantTokenMode;
  if (res.status === 401 && res.json?.code === 'APPLICANT_TOKEN_REQUIRED') mode = 'enforce';
  else if (res.status === 404 || res.status === 200) mode = 'log-or-off';
  else throw new Error(`APPLICANT_TOKEN_MODE probe: unexpected HTTP ${res.status} ${JSON.stringify(res.json)}`);
  modeCache.set(programUuid, mode);
  return mode;
}

/**
 * QA_EXPECT_APPLICANT_TOKEN_MODE (optional): 'enforce' or 'log'. When set, the SAN-1959 negative tests
 * fail if the detected mode differs, so the run after dev is flipped to enforce proves the flip
 * happened instead of quietly passing in log mode. Unset = accept whatever is detected.
 */
export function expectedApplicantTokenMode(): ApplicantTokenMode | undefined {
  const v = process.env.QA_EXPECT_APPLICANT_TOKEN_MODE?.trim().toLowerCase();
  if (!v) return undefined;
  if (v === 'enforce') return 'enforce';
  if (v === 'log' || v === 'off') return 'log-or-off';
  throw new Error(`QA_EXPECT_APPLICANT_TOKEN_MODE must be "enforce" or "log", got "${v}"`);
}
