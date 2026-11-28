'use server';

import { CandidateError } from '@credalent/candidates';
import { IntakeError } from '@credalent/intake';
import { log } from '@credalent/observability';
import { ForbiddenError } from '@credalent/workspaces';
import { revalidatePath } from 'next/cache';
import { forbidden, notFound, unstable_rethrow } from 'next/navigation';
import { getIntake } from '@/server/intake';
import { getCandidates } from '@/server/people';
import { inActiveWorkspace } from '@/server/workspace';
import { correctNameSchema, type CorrectNameResult } from '../domain/name.ts';

/**
 * Corrects a candidate's name from their profile (AIV-P1-165 §8), in the active workspace. Intake authorises the job
 * (`candidate.view`, and the member's job scope) and the candidate must be one of its applicants; the candidates
 * module then authorises the correction (admins and recruiters) and audits it last, with the member, time and reason.
 * A hiring owner or interviewer gets the 403 page; another workspace's job or candidate is not found. Logs the opaque
 * ids and error names only: never the name, old or new, nor the reason (AGENTS.md 1.2).
 */
export async function correctName(input: unknown): Promise<CorrectNameResult> {
  const parsed = correctNameSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const { candidateId, jobId, name, reason } = parsed.data;
  let result;
  try {
    result = await inActiveWorkspace(async (ctx) => {
      // SAFETY: only a candidate of a job this member may see is renamed: the id alone opens nothing.
      const applicants = await getIntake().listApplicationsForJob(ctx, jobId);
      if (!applicants.some((a) => a.personId === candidateId)) return false;
      await getCandidates().correctName(ctx, candidateId, { name, reason });
      return true;
    });
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof ForbiddenError) forbidden();
    if (error instanceof IntakeError) notFound();
    if (error instanceof CandidateError && error.code === 'person_not_found') notFound();
    if (error instanceof CandidateError) return { ok: false, error: 'invalid' };
    log.error(
      { area: 'candidates', 'error.type': error instanceof Error ? error.name : 'unknown' },
      'name correction failed',
    );
    return { ok: false, error: 'failed' };
  }
  if (!result) forbidden();
  if (!result.value) notFound();
  log.info({ area: 'candidates', candidateId, jobId }, 'candidate name corrected');
  // The ranking, the interviews, the packs and this profile all show the person's name.
  revalidatePath('/app', 'layout');
  return { ok: true };
}
