import type { InterviewsContract } from '@credalent/interviews';
import { createInterviews } from '@credalent/interviews/composition';
import { findApplication } from '@credalent/intake/composition';
import { shownQuestions } from '@/features/scorecard/domain/scorecard.ts';
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
    // What a confirmed meeting summary (AIV-P1-115) and a submitted scorecard (AIV-P2-006) end in: the assessment's own
    // preview and apply (AIV-P1-117) and the evidence contract's record. Each authorises the member itself; called lazily, so the modules build in any order.
    {
      latestAssessment: (ctx, candidateId, jobId) => getAssessment().getLatestAssessment(ctx, candidateId, jobId),
      previewScoreChange: (ctx, input) => getAssessment().previewScoreChange(ctx, input),
      applyScoreChange: (ctx, input) => getAssessment().applyScoreChange(ctx, input),
      recordSummaryEvidence: (ctx, input) => getEvidence().recordInterviewSummary(ctx, input),
      // A submitted scorecard (AIV-P2-006) is judged on the questions its page shows, read as the page reads them.
      suggestedQuestions: async (ctx, candidateId, jobId, rubricVersionId) => {
        const latest = await getAssessment().getLatestAssessment(ctx, candidateId, jobId);
        const shown = shownQuestions(
          latest?.rubricVersionId === rubricVersionId,
          await getAssessment().getSuggestedQuestions(ctx, candidateId, jobId),
        );
        return new Map([...shown].map(([id, questions]) => [id, questions.map((q) => q.text)]));
      },
    },
  ));
