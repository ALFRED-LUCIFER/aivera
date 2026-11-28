'use server';

import { EvidenceError } from '@credalent/evidence';
import { log } from '@credalent/observability';
import { ForbiddenError } from '@credalent/workspaces';
import { revalidatePath } from 'next/cache';
import { forbidden, notFound, unstable_rethrow } from 'next/navigation';
import { getEvidence } from '@/server/evidence';
import { inActiveWorkspace } from '@/server/workspace';
import { retrySchema, type RetryResult } from '../domain/cvStatus.ts';

/**
 * "Try again" on a CV (AIV-P1-134, AIV-P1-165): reads a failed CV again, or assesses the candidate's evidence for the
 * job again after mapping failed. Evidence authorises it (admins and recruiters) and audits it; a hiring owner or
 * interviewer gets the 403 page, another workspace's CV is not found, and a CV that is not failed (a second retry
 * included) changes nothing. Logs the opaque ids and the outcome only, never a name or file name.
 */
export async function retryCv(input: unknown): Promise<RetryResult> {
  const parsed = retrySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const target = parsed.data;
  let result;
  try {
    result = await inActiveWorkspace((ctx) =>
      target.kind === 'cv'
        ? getEvidence().retryCvParse(ctx, target.sourceId)
        : getEvidence().retryMapping(ctx, target.candidateId, target.jobId),
    );
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof ForbiddenError) forbidden();
    if (error instanceof EvidenceError && error.code === 'cv_not_found') notFound();
    if (error instanceof EvidenceError) return { ok: false, error: 'refused' };
    log.error({ area: 'candidates', 'error.type': error instanceof Error ? error.name : 'unknown' }, 'cv retry failed');
    return { ok: false, error: 'failed' };
  }
  if (!result) forbidden();
  log.info({ area: 'candidates', ...target }, 'cv retry queued');
  // The ranking and the profile read the CV's status again.
  revalidatePath('/app', 'layout');
  return { ok: true };
}
