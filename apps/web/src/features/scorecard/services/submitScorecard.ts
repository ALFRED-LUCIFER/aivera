'use server';

import { InterviewError } from '@credalent/interviews';
import { log } from '@credalent/observability';
import { forbidden, notFound, unstable_rethrow } from 'next/navigation';
import { getInterviews } from '@/server/interviews';
import { inActiveWorkspace } from '@/server/workspace';
import { submitInput, type SubmitOutcome } from '../domain/scorecard.ts';

const OUTCOME: Partial<Record<InterviewError['code'], SubmitOutcome>> = {
  scorecard_submitted: 'already',
  preview_changed: 'changed',
  scorecard_incomplete: 'incomplete',
  not_assessed: 'notAssessed',
  competency_not_in_rubric: 'rubricChanged',
  interview_not_held: 'notHeld',
  scorecard_closed: 'closed',
};

/**
 * Submits the member's saved scorecard draft (AIV-P2-006) through the interviews contract's `submitScorecard`, in one
 * transaction: the interview is completed, the scorecard stored, its notes recorded as evidence and the ratings the
 * person previewed applied and audited; anything thrown leaves all of it undone. It changes no stage and contacts
 * nobody (AGENTS.md 1.5). The interviews module authorises on the stored interview's job: only its interviewer,
 * holding a grant on that job, or a workspace admin; anyone else gets the 403 page. A malformed input, or an interview
 * the workspace does not have, is not found. Every other refusal is an outcome the form says.
 */
export async function submitScorecard(input: unknown): Promise<SubmitOutcome> {
  const parsed = submitInput.safeParse(input);
  if (!parsed.success) notFound();
  const { interviewId, previewId } = parsed.data;
  try {
    const result = await inActiveWorkspace((ctx) => getInterviews().submitScorecard(ctx, interviewId, { previewId }));
    if (!result) forbidden();
    return result.value.updated ? 'updated' : 'unchanged';
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof InterviewError) {
      if (error.code === 'interview_not_found') notFound();
      const outcome = OUTCOME[error.code];
      if (outcome) return outcome;
    }
    // The name only: an error's detail could repeat a note about the candidate (AGENTS.md 1.2).
    log.warn(
      { area: 'scorecard', 'error.type': error instanceof Error ? error.name : 'unknown' },
      'submit scorecard failed',
    );
    return 'failed';
  }
}
