import * as path from 'path';
import * as dotenv from 'dotenv';

/**
 * Which environment the suite runs against.
 *  - staging:    full suite; journeys that write data are allowed.
 *  - production: the QA tenant on production; read-only journeys only
 *                (anything tagged @write is skipped).
 */
export type E2EEnv = 'staging' | 'production';

export const E2E_ENV = (process.env.E2E_ENV ?? 'staging') as E2EEnv;
if (E2E_ENV !== 'staging' && E2E_ENV !== 'production') {
  throw new Error(`E2E_ENV must be "staging" or "production", got "${E2E_ENV}"`);
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
  allowWrites: E2E_ENV === 'staging',
  /** QA tenant member PWA, e.g. https://qa.sanchiconnect.com */
  get frontendUrl() {
    return required('FRONTEND_URL');
  },
  /** QA tenant admin panel, e.g. https://admin.qa.sanchiconnect.com */
  get adminUrl() {
    return required('ADMIN_URL');
  },
  /** QA tenant backend, without the /api suffix, e.g. https://api.qa.sanchiconnect.com */
  get apiUrl() {
    return required('API_URL');
  },
};
