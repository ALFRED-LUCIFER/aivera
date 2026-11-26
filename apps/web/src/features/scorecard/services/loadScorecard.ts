import { JOB_SCOPED_ROLES } from '@credalent/workspaces';
import { z } from 'zod';
import { evidenceCards } from '@/features/evidence-profile/domain/evidenceCards.ts';
import { profileHref } from '@/features/evidence-profile/domain/profile.ts';
import { questionsView } from '@/features/evidence-profile/domain/questions.ts';
import { toInterviewRows } from '@/features/interviews';
import { getAssessment } from '@/server/assessment';
import { getEvidence } from '@/server/evidence';
import { getFiles } from '@/server/files';
import { getInterviews } from '@/server/interviews';
import { getApprovedRubricReads } from '@/server/jobs';
import { inActiveWorkspace } from '@/server/workspace';
import { shownQuestions, startingDraft, type ScorecardData } from '../domain/scorecard.ts';

/**
 * Whether the member may see the interview, by the interviews contract (`getInterview`): false for a malformed id too.
 * Null with no workspace. The scorecard layout asks before the page streams, so a refusal is a 404 response.
 */
export async function seesInterview(interviewId: string): Promise<boolean | null> {
  if (!z.uuid().safeParse(interviewId).success) return false;
  const result = await inActiveWorkspace(
    async (ctx) => (await getInterviews().getInterview(ctx, interviewId)) !== null,
  );
  return result && result.value;
}

/**
 * The interview scorecard page (AIV-P2-004): the interview, what the latest assessment cites for each competency it
 * tests, the stored suggested questions (AIV-P1-113) and the member's draft. Stored reads only: no model is called
 * here, and nothing is written. 'notFound' for an interview the workspace does not have, one the member may not see
 * (the interviews contract: their job scope and, for an interviewer, their own interviews) or a malformed id; null with
 * no workspace. Assessment and evidence check `candidate.view` on the job themselves; a refusal renders the 403 page.
 */
export async function loadScorecard(interviewId: string): Promise<ScorecardData | 'notFound' | null> {
  if (!z.uuid().safeParse(interviewId).success) return 'notFound';
  const now = new Date();
  const result = await inActiveWorkspace(async (ctx): Promise<ScorecardData | 'notFound'> => {
    const scorecard = await getInterviews().getScorecard(ctx, interviewId);
    if (!scorecard) return 'notFound';
    const { interview, canEdit } = scorecard;
    const { candidateId, jobId } = interview;
    const [row] = await toInterviewRows(ctx, [interview], now);
    if (!row) return 'notFound';
    const latest = await getAssessment().getLatestAssessment(ctx, candidateId, jobId);
    // Not authorised itself: `getScorecard` and `getLatestAssessment` above authorised this job for the member.
    const approved = await getApprovedRubricReads().approvedRubric(ctx.tx, ctx.workspaceId, jobId);
    // shortcut: names, weights, evidence and questions are read on the job's approved rubric version only; an interview
    // planned on a version since replaced shows no competency. Read by version when the jobs contract offers it.
    const rubric = approved?.id === interview.rubricVersionId ? approved.competencies : [];
    const names = new Map(rubric.map((c) => [c.id, c.name]));
    const assessed = latest?.rubricVersionId === interview.rubricVersionId ? latest : null;
    const evidence = assessed ? await getEvidence().listEvidenceForCandidate(ctx, candidateId, jobId) : [];
    // SAFETY: a link to an uploaded candidate file is for admins and recruiters only (AGENTS.md 1.9), as on the profile.
    const opensFiles = !JOB_SCOPED_ROLES.includes(ctx.role) && getFiles() !== null;
    const cards = new Map(
      evidenceCards(assessed?.competencies ?? [], names, evidence, opensFiles).map((c) => [c.competencyId, c]),
    );
    // The stored set only (`getSuggestedQuestions` calls no model); questions are asked for on the evidence profile.
    const stored = assessed && (await getAssessment().getSuggestedQuestions(ctx, candidateId, jobId));
    const view = stored && questionsView(stored, names, evidence);
    const questions = shownQuestions(view);
    const competencies = interview.competencyIds.flatMap((id) => {
      const competency = rubric.find((c) => c.id === id);
      if (!competency) return [];
      return {
        competencyId: id,
        name: competency.name,
        weightPercent: competency.weightPercent,
        evidence: cards.get(id) ?? null,
        questions: questions.get(id) ?? [],
      };
    });
    return {
      interviewId,
      candidate: row.candidate,
      job: row.job,
      round: row.round,
      scheduledAt: row.scheduledAt,
      today: row.today,
      interviewer: row.interviewer,
      profileHref: profileHref(candidateId, jobId),
      rankingHref: `/app/jobs/${jobId}/candidates`,
      submitted: interview.status === 'completed',
      assessed: assessed && { at: assessed.assessedAt.toISOString(), backedScore: assessed.backedScore },
      competencies,
      canEdit,
      draft: startingDraft(competencies, scorecard.draft),
    };
  });
  return result && result.value;
}
