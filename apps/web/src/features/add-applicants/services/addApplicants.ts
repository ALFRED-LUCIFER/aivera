'use server';

import { defaultLocale, defaultTimeZone, getTranslations } from '@credalent/i18n';
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
    // shortcut: the placeholder name is stored in English; CV parsing (AIV-P1-025) replaces it with the person's name.
    const displayName = (await getTranslations(defaultLocale, defaultTimeZone))('addApplicants.unnamed');
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
