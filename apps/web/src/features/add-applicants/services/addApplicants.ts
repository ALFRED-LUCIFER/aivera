'use server';

import { UNNAMED_APPLICANT } from '@credalent/candidates';
import { IntakeError } from '@credalent/intake';
import { log } from '@credalent/observability';
import { ZodError } from 'zod';
import { getFiles } from '@/server/files';
import { getIntake } from '@/server/intake';
import { getWorkspaces, workspaceAction } from '@/server/workspace';
import { addApplicantsSchema, type AddApplicantsInput, type AddApplicantsResult } from '../domain/addApplicants.ts';
import { linkCleanCvs } from './linkCleanCvs.ts';

/**
 * "Add applicants" (AIV-P1-019): admins and recruiters (`candidate.create`; the files module checks `file.upload`
 * too); anyone else gets the 403 page, before anything else is looked at. The person is synthetic exactly when the
 * workspace is (AGENTS.md 1.1).
 */
const add = workspaceAction(
  'candidate.create',
  async (ctx, input: AddApplicantsInput): Promise<AddApplicantsResult> => {
    const files = getFiles()?.files;
    if (!files) return { ok: false, error: 'failed' };
    // shortcut: the placeholder is stored in English and shown untranslated; the CV parse names the applicant from the CV (AIV-P1-090).
    const displayName = UNNAMED_APPLICANT;
    const synthetic = (await getWorkspaces().getWorkspace(ctx))?.synthetic ?? false;
    return linkCleanCvs({ files, intake: getIntake() }, ctx, input, { displayName, synthetic });
  },
  { input: addApplicantsSchema },
);

const REFUSALS = { confirmation_required: 'confirmationRequired', job_not_found: 'jobNotFound' } as const;

export async function addApplicants(input: AddApplicantsInput): Promise<AddApplicantsResult> {
  try {
    return await add(input);
  } catch (error) {
    // Thrown out of the transaction, so a refused job rolls back everything.
    if (error instanceof IntakeError) {
      const refused = REFUSALS[error.code as keyof typeof REFUSALS];
      // The code only, never a candidate value (AGENTS.md 1.2).
      if (!refused) log.warn({ area: 'intake', 'error.code': error.code }, 'add applicants refused');
      return { ok: false, error: refused ?? 'failed' };
    }
    // The schema's literal refuses a missing or false tick before anything is authorised or read.
    if (error instanceof ZodError && error.issues.some((i) => i.path[0] === 'rightToProcessConfirmed')) {
      return { ok: false, error: 'confirmationRequired' };
    }
    throw error;
  }
}
