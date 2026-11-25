'use server';

import { InterviewError } from '@credalent/interviews';
import { log } from '@credalent/observability';
import { forbidden, notFound, unstable_rethrow } from 'next/navigation';
import { getInterviews } from '@/server/interviews';
import { inActiveWorkspace } from '@/server/workspace';
import { previewInput, type EffectPreview } from '../domain/scorecard.ts';

/**
 * What the scorecard's ratings would do to the candidate's latest assessment (AIV-P2-005), through the interviews
 * contract's `previewScorecardRatings`. It stores, audits and applies nothing; a submitted scorecard applies
 * (AIV-P2-006). The interviews module authorises as for saving the draft: only its interviewer, holding a grant on the
 * job, or a workspace admin; anyone else gets the 403 page. A malformed input, or an interview the workspace does not
 * have, is not found. Null when it cannot be previewed now (no assessment yet, evidence still being scored, an
 * interview not held): the panel says so and the rating is kept.
 */
export async function previewScorecardRatings(input: unknown): Promise<EffectPreview | null> {
  const parsed = previewInput.safeParse(input);
  if (!parsed.success) notFound();
  const { interviewId, ratings } = parsed.data;
  try {
    const result = await inActiveWorkspace((ctx) => getInterviews().previewScorecardRatings(ctx, interviewId, ratings));
    if (!result) forbidden();
    const { backedScore, changes } = result.value;
    return { backedScore, changes: changes.map(({ competencyId, from, to }) => ({ competencyId, from, to })) };
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof InterviewError) {
      if (error.code === 'interview_not_found') notFound();
      // An expected refusal ("not assessed", "preview again"): the panel says so, nothing to log.
      return null;
    }
    // The name only: an error's detail is never needed to say "Preview unavailable" (AGENTS.md 1.2).
    log.warn(
      { area: 'scorecard', 'error.type': error instanceof Error ? error.name : 'unknown' },
      'preview scorecard ratings failed',
    );
    return null;
  }
}
