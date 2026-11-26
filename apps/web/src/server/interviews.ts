import type { InterviewsContract } from '@credalent/interviews';
import { createInterviews } from '@credalent/interviews/composition';
import { findApplication } from '@credalent/intake/composition';
import { getAssessment } from './assessment';
import { getEvidence } from './evidence';
import { getApprovedRubricReads, getJobs } from './jobs';
import { getWorkspaces } from './workspace';

let interviews: InterviewsContract | undefined;
/** The app's one interviews module instance; every call takes the request context from `inActiveWorkspace`. */
export const getInterviews = (): InterviewsContract =>
  (interviews ??= createInterviews(
    getWorkspaces(),
    getJobs(),
    getApprovedRubricReads().approvedRubric,
    findApplication,
    undefined,
    // What a confirmed meeting summary ends in (AIV-P1-115): the assessment's own preview and apply (AIV-P1-117) and
    // the evidence contract's record. Each authorises the member itself; called lazily, so the modules build in any order.
    {
      latestAssessment: (ctx, candidateId, jobId) => getAssessment().getLatestAssessment(ctx, candidateId, jobId),
      previewScoreChange: (ctx, input) => getAssessment().previewScoreChange(ctx, input),
      applyScoreChange: (ctx, input) => getAssessment().applyScoreChange(ctx, input),
      recordSummaryEvidence: (ctx, input) => getEvidence().recordInterviewSummary(ctx, input),
    },
    // What a submitted scorecard ends in (AIV-P2-006): the same apply, its notes as evidence, and the questions its
    // page showed.
    {
      latestAssessment: (ctx, candidateId, jobId) => getAssessment().getLatestAssessment(ctx, candidateId, jobId),
      applyScoreChange: (ctx, input) => getAssessment().applyScoreChange(ctx, input),
      recordScorecardEvidence: (ctx, input) => getEvidence().recordInterviewSummary(ctx, input),
      suggestedQuestions: async (ctx, candidateId, jobId) => {
        const stored = await getAssessment().getSuggestedQuestions(ctx, candidateId, jobId);
        if (stored?.status !== 'suggested') return [];
        return stored.gaps.map((g) => ({ competencyId: g.competencyId, questions: g.questions.map((q) => q.text) }));
      },
    },
  ));
