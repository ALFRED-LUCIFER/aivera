'use server';

import { JobError } from '@credalent/jobs';
import { log } from '@credalent/observability';
import { ForbiddenError, WorkspaceError } from '@credalent/workspaces';
import { revalidatePath } from 'next/cache';
import { forbidden, notFound, unstable_rethrow } from 'next/navigation';
import { queueApprovalRequest } from '@/features/rubric/server.ts';
import { getJobs } from '@/server/jobs';
import { inActiveWorkspace } from '@/server/workspace';
import { changeOwnerSchema, type ChangeOwnerResult } from '../domain/hiringOwner.ts';

/**
 * Assigns or changes a job's hiring owner from the job header (AIV-P1-097, admins only: `job.change_owner`; anyone else
 * gets the 403 page, a job outside the workspace the 404). The reason goes into the audit entries. A rubric version
 * waiting for approval is emailed to the new owner in the same transaction, before the module's final audit write;
 * where sending is off (the pilot, AIV-P1-165) nothing is emailed and the owner still changes.
 */
export async function changeHiringOwner(input: unknown): Promise<ChangeOwnerResult> {
  const parsed = changeOwnerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const { jobId, ownerId, reason } = parsed.data;
  let result;
  try {
    result = await inActiveWorkspace((ctx) =>
      getJobs().changeHiringOwner(ctx, jobId, ownerId, {
        reason,
        alongside: async () => {
          const versions = (await getJobs().listRubricVersions(ctx, jobId)) ?? [];
          const waiting = versions.find((v) => v.status === 'awaiting_approval');
          if (waiting) await queueApprovalRequest(ctx, waiting);
        },
      }),
    );
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof ForbiddenError) forbidden();
    if (error instanceof JobError && error.code === 'not_found') notFound();
    if (error instanceof WorkspaceError && error.code === 'owner_role') return { ok: false, error: 'owner' };
    log.error(
      { area: 'job-header', 'error.type': error instanceof Error ? error.name : 'unknown' },
      'hiring owner change failed',
    );
    return { ok: false, error: 'failed' };
  }
  if (!result) forbidden();
  revalidatePath(`/app/jobs/${jobId}`, 'layout');
  revalidatePath('/app/jobs');
  return { ok: true };
}
