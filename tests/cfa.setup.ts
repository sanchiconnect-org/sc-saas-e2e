/**
 * CFA regression suite (FT-006), per-run setup: reads the CFA flags once, then creates this
 * run's test-mode program and writes it to .cfa/run.json for tests/cfa/**.
 * Owner: Ritu Raj
 *
 * When a prerequisite is missing (admin secrets, QA_CFA_TEMPLATE_FORM_ID) or CFA is off on
 * the tenant, it records the reason in run.json and skips; every CFA test then skips with
 * that reason instead of failing. tests/cfa.teardown.ts deletes the program afterwards.
 */
import { test as setup } from '@playwright/test';
import { adminAccount } from '../config/accounts';
import { env } from '../config/env';
import {
  CfaAdmin,
  cfaPrerequisiteSkipReason,
  cfaRunId,
  createCfaProgram,
  readCfaFlags,
  writeCfaRun,
} from '../fixtures/cfa';

setup('create the per-run CFA program', { tag: ['@regression', '@cfa', '@write'] }, async ({ browser }) => {
  setup.setTimeout(180_000);
  const runId = cfaRunId();
  /* Overwrite any previous run.json first, so a failed setup never leaves a stale program for the tests. */
  writeCfaRun({ runId, skipReason: 'cfa-setup did not finish' });

  const missing = cfaPrerequisiteSkipReason({
    adminConfigured: !!adminAccount('admin'),
    templateFormId: env.cfa.templateFormId,
  });
  if (missing) {
    writeCfaRun({ runId, skipReason: missing });
    setup.skip(true, missing);
  }

  const flags = await readCfaFlags(browser);
  if (flags.application_management === false) {
    const reason = 'application_management is off on this tenant';
    writeCfaRun({ runId, flags, skipReason: reason });
    setup.skip(true, reason);
  }

  const admin = new CfaAdmin();
  try {
    const program = await createCfaProgram(admin, { runId });
    writeCfaRun({ runId, flags, program });
    setup.info().annotations.push({ type: 'cfa-program', description: `${program.title} (id ${program.id})` });
  } finally {
    await admin.dispose();
  }
});
