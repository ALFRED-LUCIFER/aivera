'use server';

import { InterviewError } from '@credalent/interviews';
import { log } from '@credalent/observability';
import { ForbiddenError } from '@credalent/workspaces';
import { revalidatePath } from 'next/cache';
import { forbidden, notFound, unstable_rethrow } from 'next/navigation';
import { getInterviews } from '@/server/interviews';
import { inActiveWorkspace } from '@/server/workspace';
import { scheduleSchema, type ScheduleResult } from '../domain/schedule.ts';

/**
 * Gives an interview its time and interviewer (AIV-P2-007). The interviews module authorises it (admins and
 * recruiters on the job), refuses a past time and warns of the interviewer's clash; a hiring owner or interviewer gets
 * the 403 page. Nobody is contacted. Logs ids and error names only.
 */
export async function scheduleInterview(input: unknown): Promise<ScheduleResult> {
  const parsed = scheduleSchema.safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      error: parsed.error.issues.some((i) => i.path[0] === 'interviewerUserId') ? 'noInterviewer' : 'pastTime',
    };
  const { scheduledAt, ...rest } = parsed.data;
  let result;
  try {
    result = await inActiveWorkspace((ctx) =>
      getInterviews().scheduleInterview(ctx, { ...rest, scheduledAt: new Date(scheduledAt) }),
    );
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof ForbiddenError) forbidden();
    if (error instanceof InterviewError) {
      if (error.code === 'interview_not_found') notFound();
      if (error.code === 'time_in_past') return { ok: false, error: 'pastTime' };
      if (error.code === 'interviewer_not_on_job') return { ok: false, error: 'notOnJob' };
    }
    log.error(
      { area: 'interviews', 'error.type': error instanceof Error ? error.name : 'unknown' },
      'schedule interview failed',
    );
    return { ok: false, error: 'failed' };
  }
  if (!result) forbidden();
  if (result.value.status === 'clash')
    return { ok: false, error: 'clash', clashAt: result.value.clashAt.toISOString() };
  log.info({ area: 'interviews', interviewId: parsed.data.interviewId }, 'interview scheduled');
  // The Interviews page, its sidebar count and the candidates' round labels read the new time.
  revalidatePath('/app', 'layout');
  return { ok: true };
}
