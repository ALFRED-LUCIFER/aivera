'use server';

import { JobError } from '@credalent/jobs';
import { log } from '@credalent/observability';
import { ForbiddenError } from '@credalent/workspaces';
import { revalidatePath } from 'next/cache';
import { forbidden, notFound, unstable_rethrow } from 'next/navigation';
import { getJobs } from '@/server/jobs';
import { inActiveWorkspace } from '@/server/workspace';
import { nameSelfSchema, type NameSelfResult } from '../domain/pack.ts';

/**
 * Names the signed-in admin the job's hiring owner from its decision pack (AIV-P1-165, owner decision (b)), so a solo
 * recruiter can record decisions. Only while the job has no hiring owner: it never takes a job from one already named.
 * The jobs module authorises it (`job.change_owner`, admins only: anyone else gets the 403 page) and audits
 * `job.hiring_owner_changed` with the reason, last. Nobody is emailed. Logs ids and error names only.
 */
export async function nameSelfOwner(input: unknown): Promise<NameSelfResult> {
  const parsed = nameSelfSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const { jobId, reason } = parsed.data;
  let result;
  try {
    // SAFETY: a job that already has a hiring owner keeps them; jobs checks it under the job's row lock (`onlyIfNone`).
    result = await inActiveWorkspace((ctx) =>
      getJobs().changeHiringOwner(ctx, jobId, ctx.userId, { reason, onlyIfNone: true }),
    );
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof ForbiddenError) forbidden();
    if (error instanceof JobError && error.code === 'not_found') notFound();
    if (error instanceof JobError && error.code === 'owner_taken') return { ok: false, error: 'taken' };
    log.error(
      { area: 'decisions', 'error.type': error instanceof Error ? error.name : 'unknown' },
      'name self hiring owner failed',
    );
    return { ok: false, error: 'failed' };
  }
  if (!result) forbidden();
  log.info({ area: 'decisions', jobId }, 'admin named hiring owner');
  revalidatePath(`/app/jobs/${jobId}`, 'layout');
  return { ok: true };
}
