'use server';

import { IntakeError } from '@credalent/intake';
import { InterviewError } from '@credalent/interviews';
import { log } from '@credalent/observability';
import { ForbiddenError } from '@credalent/workspaces';
import { revalidatePath } from 'next/cache';
import { forbidden, notFound, unstable_rethrow } from 'next/navigation';
import { getIntake } from '@/server/intake';
import { inActiveWorkspace } from '@/server/workspace';
import { chooseSchema, type ChooseResult } from '../domain/choose.ts';

/**
 * Runs a confirmed choice for interview in the active workspace (AIV-P1-114). Intake authorises it (admins and
 * recruiters on the job) and audits each person with the member, time and reason; a hiring owner or interviewer gets
 * the 403 page, and another workspace's job is not found. Logs ids, counts and error names only.
 */
export async function chooseForInterview(input: unknown): Promise<ChooseResult> {
  const parsed = chooseSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  let result;
  try {
    result = await inActiveWorkspace((ctx) => getIntake().chooseForInterview(ctx, parsed.data));
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof ForbiddenError) forbidden();
    if (error instanceof IntakeError && error.code === 'job_not_found') notFound();
    if (error instanceof IntakeError && error.code === 'not_on_job') return { ok: false, error: 'notOnJob' };
    if (error instanceof IntakeError || error instanceof InterviewError) return { ok: false, error: 'refused' };
    log.error(
      { area: 'candidates', 'error.type': error instanceof Error ? error.name : 'unknown' },
      'choose for interview failed',
    );
    return { ok: false, error: 'failed' };
  }
  if (!result) forbidden();
  log.info(
    { area: 'candidates', jobId: parsed.data.jobId, 'credalent.intake.chosen': result.value.chosen.length },
    'chosen for interview',
  );
  // The ranking, the job's stages and the Interviews page all read the new stage and interviews.
  revalidatePath('/app', 'layout');
  return { ok: true, chosen: result.value.chosen.length };
}
