'use server';

import { log } from '@credalent/observability';
import { forbidden, notFound, unstable_rethrow } from 'next/navigation';
import { getAssessment } from '@/server/assessment';
import { inActiveWorkspace } from '@/server/workspace';
import { questionsInput, type SuggestOutcome } from '../domain/questions.ts';
import { viewOf } from './loadQuestions.ts';

/**
 * "Suggest interview questions" (AIV-P1-113): one model call for one candidate and job, on demand, so the workspace's
 * AI allowance is spent only on people the recruiter is considering. The assessment module authorises the job
 * (`candidate.view`: admins and recruiters, hiring owners and interviewers on a granted job; anyone else gets the 403
 * page) before anything is read or asked. A candidate or job the workspace does not have, or a malformed id, is not
 * found. The questions are guidance for a person: nothing here changes a score, stage or rank (AGENTS.md 1.5).
 */
// shortcut: the model call (up to a minute, twice on a rejected answer) runs inside the request's transaction, as the
// ranking explanation's does; move it to a worker if pilot recruiters wait on it or it holds connections.
export async function suggestQuestions(input: unknown): Promise<SuggestOutcome> {
  const parsed = questionsInput.safeParse(input);
  if (!parsed.success) notFound();
  const { candidateId, jobId } = parsed.data;
  try {
    const result = await inActiveWorkspace(async (ctx): Promise<SuggestOutcome | null> => {
      const outcome = await getAssessment().suggestInterviewQuestions(ctx, candidateId, jobId);
      if (!outcome) return null;
      if (outcome.status === 'budget_exceeded') return { status: 'waiting' };
      if (outcome.status === 'failed') return { status: 'failed' };
      return viewOf(ctx, candidateId, jobId, outcome);
    });
    if (!result) forbidden();
    if (!result.value) notFound();
    return result.value;
  } catch (error) {
    unstable_rethrow(error);
    // The name only: an error's detail could repeat a question or an excerpt (AGENTS.md 1.2).
    log.warn(
      { area: 'evidence-profile', 'error.type': error instanceof Error ? error.name : 'unknown' },
      'suggest questions failed',
    );
    return { status: 'failed' };
  }
}
