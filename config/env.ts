import * as path from 'path';
import * as dotenv from 'dotenv';

/**
 * Which environment the suite runs against — one per deployed branch:
 *  - development: ai_native_setup (sanchidev.in). Full suite; writes allowed. Start here.
 *  - staging:     stagingdemo (AWS via Jenkins). Full suite; writes allowed on its QA tenant only.
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
  allowWrites: E2E_ENV !== 'production',
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
};
