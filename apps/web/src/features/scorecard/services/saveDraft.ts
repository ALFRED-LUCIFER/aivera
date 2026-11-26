'use server';

import { InterviewError } from '@credalent/interviews';
import { log } from '@credalent/observability';
import { forbidden, notFound, unstable_rethrow } from 'next/navigation';
import { getInterviews } from '@/server/interviews';
import { inActiveWorkspace } from '@/server/workspace';
import { saveDraftInput } from '../domain/scorecard.ts';

/**
 * Saves the member's scorecard draft (AIV-P2-004). It changes no score, stage or status, and calls no model: the
 * assessment changes only when a scorecard is submitted (AIV-P2-006). The interviews module authorises on the stored
 * interview's job: only its interviewer, holding a grant on that job, or a workspace admin; anyone else gets the 403
 * page and nothing is stored. A malformed input, or an interview the workspace does not have, is not found.
 * 'submitted' when the interview is completed, 'closed' when it is cancelled; false when the save failed otherwise:
 * the form says so and keeps the text.
 */
export async function saveScorecardDraft(input: unknown): Promise<boolean | 'submitted' | 'closed'> {
  const parsed = saveDraftInput.safeParse(input);
  if (!parsed.success) notFound();
  const { interviewId, draft } = parsed.data;
  try {
    const result = await inActiveWorkspace((ctx) => getInterviews().saveScorecardDraft(ctx, interviewId, draft));
    if (!result) forbidden();
    return true;
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof InterviewError && error.code === 'interview_not_found') notFound();
    // Submitted (AIV-P2-006) or cancelled since the page loaded: the form says which instead of "try again".
    if (error instanceof InterviewError && error.code === 'scorecard_submitted') return 'submitted';
    if (error instanceof InterviewError && error.code === 'scorecard_closed') return 'closed';
    // The name only: an error's detail could repeat a note about the candidate (AGENTS.md 1.2).
    log.warn(
      { area: 'scorecard', 'error.type': error instanceof Error ? error.name : 'unknown' },
      'save scorecard draft failed',
    );
    return false;
  }
}
