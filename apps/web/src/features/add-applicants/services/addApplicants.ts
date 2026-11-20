'use server';

import { defaultLocale, defaultTimeZone, getTranslations } from '@credalent/i18n';
import { IntakeError } from '@credalent/intake';
import { revalidatePath } from 'next/cache';
import { getFiles } from '@/server/files';
import { getIntake } from '@/server/intake';
import { getWorkspaces, workspaceAction } from '@/server/workspace';
import { addApplicantsSchema, type AddApplicantsInput, type AddApplicantsResult } from '../domain/addApplicants.ts';
import { linkCleanCvs } from './linkCleanCvs.ts';

/**
 * "Add applicants" (AIV-P1-019): admins and recruiters (`candidate.create`; the files module checks `file.upload`
 * too); anyone else gets the 403 page. The person is synthetic exactly when the workspace is (AGENTS.md 1.1).
 */
export async function addApplicants(input: AddApplicantsInput): Promise<AddApplicantsResult> {
  const files = getFiles()?.files;
  if (!files) return { ok: false, error: 'failed' };
  const displayName = (await getTranslations(defaultLocale, defaultTimeZone))('addApplicants.unnamed');
  const add = workspaceAction(
    'candidate.create',
    async (ctx, data: AddApplicantsInput) => {
      const synthetic = (await getWorkspaces().getWorkspace(ctx))?.synthetic ?? false;
      return linkCleanCvs({ files, intake: getIntake() }, ctx, data, { displayName, synthetic });
    },
    { input: addApplicantsSchema },
  );
  try {
    const result = await add(input);
    if (result.ok) revalidatePath(`/app/jobs/${input.jobId}/candidates`);
    return result;
  } catch (error) {
    // Thrown out of the transaction, so a refused job rolls back everything.
    if (error instanceof IntakeError) return { ok: false, error: 'jobNotFound' };
    throw error;
  }
}
