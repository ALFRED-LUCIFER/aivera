'use server';

import { UNNAMED_APPLICANT } from '@credalent/candidates';
import { IntakeError } from '@credalent/intake';
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
    // The placeholder is stored in English; the CV parse names the applicant from the CV (AIV-P1-090).
    const displayName = UNNAMED_APPLICANT;
    const synthetic = (await getWorkspaces().getWorkspace(ctx))?.synthetic ?? false;
    return linkCleanCvs({ files, intake: getIntake() }, ctx, input, { displayName, synthetic });
  },
  { input: addApplicantsSchema },
);

export async function addApplicants(input: AddApplicantsInput): Promise<AddApplicantsResult> {
  try {
    return await add(input);
  } catch (error) {
    // Thrown out of the transaction, so a refused job rolls back everything.
    if (error instanceof IntakeError) return { ok: false, error: 'jobNotFound' };
    throw error;
  }
}
