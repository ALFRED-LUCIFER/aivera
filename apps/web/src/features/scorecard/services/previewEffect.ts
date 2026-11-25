'use server';

import { log } from '@credalent/observability';
import { notFound, unstable_rethrow } from 'next/navigation';
import { getAssessment } from '@/server/assessment';
import { getInterviews } from '@/server/interviews';
import { inActiveWorkspace } from '@/server/workspace';
import { previewInput, type ScoreEffect } from '../domain/scorecard.ts';

/**
 * What the scorecard's ratings would do to the candidate's latest assessment (AIV-P2-005): the assessment's own
 * `previewScoreChange`, the scoring `assessCandidate` runs. Reads only: it stores, audits and applies nothing; a
 * submitted scorecard applies (AIV-P2-006). The interviews contract finds the interview as the member may see it, and
 * the assessment checks `candidate.view` on its job. Null when it cannot be previewed now (no assessment yet, evidence
 * still being scored, an interview not held or not theirs): the panel says so and the rating is kept.
 */
export async function previewScorecardRatings(input: unknown): Promise<ScoreEffect | null> {
  const parsed = previewInput.safeParse(input);
  if (!parsed.success) notFound();
  const { interviewId, ratings } = parsed.data;
  try {
    const result = await inActiveWorkspace(async (ctx) => {
      const interview = await getInterviews().getInterview(ctx, interviewId);
      if (!interview) return null;
      const latest = await getAssessment().getLatestAssessment(ctx, interview.candidateId, interview.jobId);
      if (!latest) return null;
      const { backedScore, changes } = await getAssessment().previewScoreChange(ctx, {
        assessmentId: latest.id,
        interviewId,
        changes: ratings,
      });
      return { backedScore, changes: changes.map(({ competencyId, from, to }) => ({ competencyId, from, to })) };
    });
    return result && result.value;
  } catch (error) {
    unstable_rethrow(error);
    // The name only: an error's detail is never needed to say "Preview unavailable" (AGENTS.md 1.2).
    log.warn(
      { area: 'scorecard', 'error.type': error instanceof Error ? error.name : 'unknown' },
      'preview scorecard ratings failed',
    );
    return null;
  }
}
