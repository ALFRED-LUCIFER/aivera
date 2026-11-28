'use server';

import { IntakeError } from '@credalent/intake';
import { log } from '@credalent/observability';
import { ZodError, type z } from 'zod';
import { RIGHT_TO_PROCESS_KEY } from '@/features/add-applicants/domain/addApplicants.ts';
import { getFiles } from '@/server/files';
import { getIntake } from '@/server/intake';
import { workspaceAction } from '@/server/workspace';
import {
  addSheetImportSchema,
  confirmMappingSchema,
  startSheetImportSchema,
  type SheetActionError,
  type SheetActionResult,
} from '../domain/sheetImport.ts';

// The sheet import's actions (AIV-P1-103): admins and recruiters (`candidate.create`); anyone else gets the 403 page
// before anything is read. Each import is its starter's: intake refuses another member's as not found. Nothing about
// the sheet but ids and codes reaches a log (AGENTS.md 1.2).

const REFUSALS: Partial<Record<IntakeError['code'], SheetActionError>> = {
  job_not_found: 'jobNotFound',
  sheet_not_found: 'notReady',
  sheet_not_ready: 'notReady',
  invalid_mapping: 'invalidMapping',
  confirmation_required: 'confirmationRequired',
};

/** A refusal becomes its code for the page; anything else is thrown out of the transaction, which rolls it back. */
async function refusing<T>(work: () => Promise<SheetActionResult<T>>): Promise<SheetActionResult<T>> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof IntakeError) {
      const refused = REFUSALS[error.code];
      // The code only, never a sheet value (AGENTS.md 1.2).
      if (!refused) log.warn({ area: 'intake', 'error.code': error.code }, 'sheet import refused');
      return { ok: false, error: refused ?? 'failed' };
    }
    // The schema's literal refuses a missing or false tick before anything is authorised or read.
    if (error instanceof ZodError && error.issues.some((i) => i.path[0] === 'rightToProcessConfirmed'))
      return { ok: false, error: 'confirmationRequired' };
    throw error;
  }
}

const start = workspaceAction(
  'candidate.create',
  async (ctx, input: z.infer<typeof startSheetImportSchema>): Promise<SheetActionResult<{ sheetImportId: string }>> => {
    const files = getFiles()?.files;
    if (!files) return { ok: false, error: 'failed' };
    // SAFETY: the browser's word that the sheet is clean is never trusted; the files module's own record decides.
    const clean = await files.findCleanUpload(ctx, input.fileId);
    if (clean?.purpose !== 'candidate_sheet') return { ok: false, error: 'notAccepted' };
    return { ok: true, ...(await getIntake().startSheetImport(ctx, input)) };
  },
  { input: startSheetImportSchema },
);

const confirm = workspaceAction(
  'candidate.create',
  async (ctx, input: z.infer<typeof confirmMappingSchema>): Promise<SheetActionResult> => {
    await getIntake().confirmSheetMapping(ctx, input);
    return { ok: true };
  },
  { input: confirmMappingSchema },
);

const add = workspaceAction(
  'candidate.create',
  async (ctx, input: z.infer<typeof addSheetImportSchema>): Promise<SheetActionResult> => {
    await getIntake().addSheetImport(ctx, { ...input, wordingKey: RIGHT_TO_PROCESS_KEY });
    return { ok: true };
  },
  { input: addSheetImportSchema },
);

/** The member's clean sheet upload, for the job: the worker reads its header row next. */
export async function startSheetImport(input: z.infer<typeof startSheetImportSchema>) {
  return refusing(() => start(input));
}

/** The recruiter's mapping: the worker reads the rows and fetches their CV links. Nobody is added. */
export async function confirmSheetMapping(input: z.infer<typeof confirmMappingSchema>) {
  return refusing(() => confirm(input));
}

/** "Add N people to this job", after the recruiter's tick: one batch, audited (AIV-P1-104). */
export async function addSheetImport(input: z.infer<typeof addSheetImportSchema>) {
  return refusing(() => add(input));
}
