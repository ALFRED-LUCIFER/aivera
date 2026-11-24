'use server';

import { CandidateError } from '@credalent/candidates';
import { log } from '@credalent/observability';
import { ForbiddenError } from '@credalent/workspaces';
import { revalidatePath } from 'next/cache';
import { forbidden, unstable_rethrow } from 'next/navigation';
import { getCandidates } from '@/server/people';
import { inActiveWorkspace } from '@/server/workspace';
import { mergeSchema, undoMergeSchema, type MergeResult } from '../domain/duplicates.ts';

/**
 * Runs a confirmed merge or undo in the active workspace (AIV-P1-018). The candidates module authorises it (merge:
 * admins and recruiters; undo: admins) and audits it with the member, time and reason; anyone else gets the 403 page.
 * A refused merge (already merged, the undo window passed) comes back as 'refused'. Logs ids and error names only.
 */
async function run(work: Parameters<typeof inActiveWorkspace>[0]): Promise<MergeResult> {
  let result;
  try {
    result = await inActiveWorkspace(work);
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof ForbiddenError) forbidden();
    if (error instanceof CandidateError) return { ok: false, error: 'refused' };
    log.error(
      { area: 'candidates', 'error.type': error instanceof Error ? error.name : 'unknown' },
      'duplicate merge failed',
    );
    return { ok: false, error: 'failed' };
  }
  if (!result) forbidden();
  revalidatePath('/app/jobs', 'layout');
  return { ok: true };
}

export async function mergeDuplicate(input: unknown): Promise<MergeResult> {
  const parsed = mergeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const { survivorId, mergedId, reason } = parsed.data;
  return run((ctx) => getCandidates().mergePeople(ctx, survivorId, mergedId, reason));
}

export async function undoMerge(input: unknown): Promise<MergeResult> {
  const parsed = undoMergeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const { mergeId, reason } = parsed.data;
  return run((ctx) => getCandidates().unmergePeople(ctx, mergeId, reason));
}
