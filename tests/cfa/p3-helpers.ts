/**
 * Shared by the CFA P3 specs (FT-006 / SAN-1881): the application form every P3 throwaway
 * program gets, and its factory. Not a spec file itself.
 */
import { expect } from '@playwright/test';
import { createCfaProgram, deleteCfaProgram, type CfaAdmin, type CfaFormSection, type CfaProgram, type TableApplication } from '../../fixtures/cfa';

/** One required short-text question, one optional long-text, one file upload. */
export const SHORT = { key: 'field_qaP3Short', name: 'QA short answer' };
export const NOTES = { key: 'field_qaP3Notes', name: 'QA notes' };
export const FILE = { key: 'field_qaP3File', name: 'QA pitch file' };
export const P3_FORM: CfaFormSection[] = [
  {
    key: 'section_qaP3',
    name: 'QA application',
    fields: [
      { ...SHORT, type: 'text_field', required: true },
      { ...NOTES, type: 'text_area' },
      { ...FILE, type: 'file_upload' },
    ],
  },
];

/** A short random tag, alphanumeric only so admin searches do a substring match. */
export const rand = () => Math.random().toString(36).slice(2, 8);

/**
 * A test-mode throwaway program (2 rounds, re-application immediate) with the P3 form.
 * bypass_otp_verification is on unless told otherwise. Recorded for cfa-teardown like every factory program.
 */
export async function createP3Program(admin: CfaAdmin, runId: string, label: string, opts: { bypassOtp?: boolean } = {}): Promise<CfaProgram> {
  const program = await createCfaProgram(admin, { runId, label, bypassOtp: opts.bypassOtp ?? true, ratingCriteriaOnLastRound: false });
  try {
    await admin.saveFormFields(program.formId, P3_FORM);
  } catch (e) {
    await deleteCfaProgram(admin, program.id).catch(() => undefined);
    throw e;
  }
  return program;
}

/** The one admin table-view row matching `match` (fails unless exactly one matches). */
export async function tableRow(admin: CfaAdmin, program: CfaProgram, match: (row: TableApplication) => boolean): Promise<TableApplication> {
  const rows = (await admin.submittedApplications(program)).filter(match);
  expect(rows, 'matching rows in the admin table view').toHaveLength(1);
  return rows[0];
}
