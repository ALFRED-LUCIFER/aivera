'use server';

import { InterviewError } from '@credalent/interviews';
import { log } from '@credalent/observability';
import { ForbiddenError } from '@credalent/workspaces';
import type { Route } from 'next';
import { revalidatePath } from 'next/cache';
import { forbidden, notFound, redirect, unstable_rethrow } from 'next/navigation';
import { z } from 'zod';
import { getInterviews } from '@/server/interviews';
import { inActiveWorkspace } from '@/server/workspace';
import { scorecardHref } from '../domain/interviews.ts';

/**
 * "Start interview" (AIV-P1-165 §12): marks the interview started and opens its scorecard. The interviews module
 * authorises it on the stored interview's job (`interview.conduct`; a hiring owner or interviewer only their own) and
 * refuses a move the status does not allow; an interview already started still opens its scorecard. Anyone else gets
 * the 403 page, and a malformed id or another workspace's interview is not found. It contacts nobody and changes no
 * stage or score (AGENTS.md 1.5). Logs the opaque id only.
 */
export async function startInterview(interviewId: unknown): Promise<never> {
  const id = z.uuid().safeParse(interviewId);
  if (!id.success) notFound();
  try {
    const result = await inActiveWorkspace((ctx) => getInterviews().startInterview(ctx, id.data));
    if (!result) forbidden();
    log.info({ area: 'interviews', interviewId: id.data }, 'interview started');
    // The lists and the ranking read the interview's new status.
    revalidatePath('/app', 'layout');
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof ForbiddenError) forbidden();
    if (error instanceof InterviewError && error.code === 'interview_not_found') notFound();
    // Already started, completed or cancelled (`status_move`): its scorecard says which.
    if (!(error instanceof InterviewError)) throw error;
  }
  // scorecardHref builds the path from the interview id, which typed routes cannot check.
  redirect(scorecardHref(id.data) as Route);
}
