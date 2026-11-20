'use server';

import { JobError, RETURN_NOTE_MAX } from '@credalent/jobs';
import { log } from '@credalent/observability';
import { revalidatePath } from 'next/cache';
import { forbidden, unstable_rethrow } from 'next/navigation';
import { z } from 'zod';
import { getJobs } from '@/server/jobs';
import { inActiveWorkspace } from '@/server/workspace';
import type { DecisionResult } from '../domain/rubric.ts';
import { queueDecisionEmail } from './rubricEmails.ts';

const input = z.object({
  jobId: z.uuid(),
  versionId: z.uuid(),
  revision: z.int().min(0),
  // Present only for a return; the jobs module trims and checks it again.
  note: z.string().max(RETURN_NOTE_MAX).optional(),
});

/**
 * "Approve version N" and "Return with a note" (AIV-P1-014), each in one transaction with the email to the recruiter
 * who sent it. The jobs module allows only the job's hiring owner or an admin acting as owner (anyone else gets the 403
 * page), refuses a decision on an older copy (`stale`), and on approval writes RubricApproved.v1, which starts
 * assessment.
 */
export async function decideRubric(raw: z.input<typeof input>): Promise<DecisionResult> {
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { error: 'failed' };
  const { jobId, versionId, revision, note } = parsed.data;
  let result;
  try {
    result = await inActiveWorkspace(async (ctx) => {
      // The email is queued before the module's audit write, which stays last (AGENTS.md 3.6).
      const email = () => queueDecisionEmail(ctx, jobId, versionId);
      if (note === undefined) await getJobs().approveRubric(ctx, versionId, revision, email);
      else await getJobs().returnRubric(ctx, versionId, note, revision, email);
    });
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof JobError && error.code === 'stale') return { error: 'stale' };
    // The name and code only: an error's detail can repeat the note typed (AGENTS.md 1.2).
    log.error(
      {
        area: 'rubric',
        'error.type': error instanceof Error ? error.name : 'unknown',
        'error.code': error instanceof JobError ? error.code : undefined,
      },
      'decision failed',
    );
    return { error: 'failed' };
  }
  if (!result) forbidden();
  revalidatePath(`/app/jobs/${jobId}`, 'layout');
  return { ok: true };
}
