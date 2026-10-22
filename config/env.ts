import * as path from 'path';
import * as dotenv from 'dotenv';

/**
 * Which environment the suite runs against — one per deployed branch:
 *  - development: ai_native_setup (sanchidev.in). Full suite; writes allowed. Start here.
 *  - staging:     stagingdemo (AWS via Jenkins) = demo.sanchiapp.com, a production demo site that
 *                 prospects see. Read-only: anything tagged @write is skipped (decided 2026-10-22).
 *  - production:  main/master (AWS via Jenkins). QA tenant only; read-only — anything
 *                 tagged @write is skipped.
 */
export const E2E_ENVS = ['development', 'staging', 'production'] as const;
export type E2EEnv = (typeof E2E_ENVS)[number];

export const E2E_ENV = (process.env.E2E_ENV ?? 'development') as E2EEnv;
if (!E2E_ENVS.includes(E2E_ENV)) {
  throw new Error(`E2E_ENV must be one of ${E2E_ENVS.join(', ')}; got "${E2E_ENV}"`);
}

/* Locally, settings come from .env.<env> (git-ignored). In CI they come from GitHub secrets. */
dotenv.config({ path: path.resolve(__dirname, '..', `.env.${E2E_ENV}`), quiet: true });

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required setting ${name} for E2E_ENV=${E2E_ENV}. See env.example.`);
  }
  return value.replace(/\/+$/, '');
}

export const env = {
  name: E2E_ENV,
  /* Only development writes. staging (the demo site) and production are read-only. */
  allowWrites: E2E_ENV === 'development',
  /** QA tenant member PWA, e.g. https://thub.sanchidev.in */
  get frontendUrl() {
    return required('FRONTEND_URL');
  },
  /** QA tenant admin panel, e.g. https://adm.thub.sanchidev.in */
  get adminUrl() {
    return required('ADMIN_URL');
  },
  /** QA tenant backend, without the /api suffix, e.g. https://api.thub.sanchidev.in */
  get apiUrl() {
    return required('API_URL');
  },
  /** Optional: a registered partner spoke of the QA tenant, e.g. https://<abbr>.thub.sanchidev.in */
  get spokeUrl(): string | undefined {
    return process.env.SPOKE_URL?.replace(/\/+$/, '') || undefined;
  },
  /**
   * Tenants cockpit (verify_tenant / tenant-settings / resolve-domain). Optional override via
   * COCKPIT_URL; defaults are in config/tenant-contract.ts by E2E_ENV (SAN-1609).
   */
  get cockpitUrl(): string | undefined {
    return process.env.COCKPIT_URL?.replace(/\/+$/, '') || undefined;
  },
  /** CFA regression suite settings (FT-006). All optional: what needs a missing one skips. */
  cfa: {
    /** Admin id of the hand-made "[QA] E2E template form" whose fields every CFA program imports. Required by the cfa project. */
    get templateFormId(): string | undefined {
      return process.env.QA_CFA_TEMPLATE_FORM_ID?.trim() || undefined;
    },
    /** Admin id of the long-lived "[QA] CFA NDA (do not delete)" program (P5 only). */
    get ndaProgramId(): string | undefined {
      return process.env.QA_CFA_NDA_PROGRAM_ID?.trim() || undefined;
    },
    /** "{code}/{slug}" of the long-lived "[QA] CFA Closed (do not delete)" program (P3/P4 only). */
    get closedProgramPath(): string | undefined {
      return process.env.QA_CFA_CLOSED_PROGRAM_PATH?.trim().replace(/^\/+|\/+$/g, '') || undefined;
    },
    /** Guest-applicant address pattern with one "*" in the local part, e.g. sc_cfa_*@yopmail.com (SAN-1877). */
    get emailPattern(): string | undefined {
      return process.env.QA_CFA_EMAIL_PATTERN?.trim() || undefined;
    },
  },
};
