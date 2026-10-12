/**
 * CFA regression suite (FT-006), per-run teardown. Runs after every test that depends on
 * cfa-setup, even when some of them failed. It deletes:
 *  1. every program this machine recorded in .cfa/programs/ (the run program, plus any
 *     throwaway a test failed to clean up),
 *  2. anything else titled "[QA] CFA run-<this runId>...",
 *  3. orphans: "[QA] CFA run-*" programs whose run started more than 24h ago (crashed runs).
 * Then it checks the run program no longer opens in the admin wizard nor on the backend.
 * Owner: Ritu Raj
 *
 * Program deletion leaves leads, documents, AI analyses, notifications, S3 objects and
 * email logs behind; clearing those is SAN-1613's job.
 */
import { expect, test as teardown } from '@playwright/test';
import { adminAccount } from '../config/accounts';
import {
  CfaAdmin,
  deleteCfaProgram,
  deleteRunPrograms,
  readCfaRun,
  recordedPrograms,
  removeCfaRun,
  sweepOrphanPrograms,
} from '../fixtures/cfa';

teardown('delete the per-run CFA program, throwaways and orphans', { tag: ['@regression', '@cfa', '@write'] }, async () => {
  teardown.setTimeout(180_000);
  teardown.skip(!adminAccount('admin'), 'QA_ADMIN_EMAIL / QA_ADMIN_PASSWORD not set');

  const run = readCfaRun();
  const admin = new CfaAdmin();
  const failures: string[] = [];
  try {
    for (const record of recordedPrograms()) {
      await deleteCfaProgram(admin, record.id).catch((e: Error) => failures.push(`${record.title} (${record.id}): ${e.message}`));
    }
    if (run?.runId) {
      await deleteRunPrograms(admin, run.runId).catch((e: Error) => failures.push(`run ${run.runId}: ${e.message}`));
    }
    const orphans = await sweepOrphanPrograms(admin).catch((e: Error) => {
      failures.push(`orphan sweep: ${e.message}`);
      return [] as string[];
    });
    if (orphans.length) teardown.info().annotations.push({ type: 'cfa-orphans-deleted', description: orphans.join(', ') });

    if (run?.program) {
      expect(await admin.programExists(run.program.id), `program ${run.program.id} still opens in the admin wizard`).toBe(false);
      expect((await admin.programByCode(run.program.code)).status, 'backend still serves the program by code').toBe(404);
    }
  } finally {
    await admin.dispose();
  }

  expect(failures, 'CFA cleanup failures').toEqual([]);
  removeCfaRun();
});
