import type { CurrentsConfig } from '@currents/playwright';

/**
 * SAN-1611 — Currents results dashboard (flake history trial).
 * Only used when CURRENTS_PROJECT_ID + CURRENTS_RECORD_KEY are set
 * (see playwright.config.ts). Keep the record key out of git.
 */
const config: CurrentsConfig = {
  recordKey: process.env.CURRENTS_RECORD_KEY!,
  projectId: process.env.CURRENTS_PROJECT_ID!,
  ciBuildId:
    process.env.CURRENTS_CI_BUILD_ID ||
    (process.env.GITHUB_RUN_ID
      ? `gh-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT ?? '1'}`
      : undefined),
};

export default config;
