import type { SuggestedQuestions } from '@credalent/assessment';
import type { WorkspaceContext } from '@credalent/workspaces';
import { getAssessment } from '@/server/assessment';
import { getEvidence } from '@/server/evidence';
import { getApprovedRubricReads } from '@/server/jobs';
import { inActiveWorkspace } from '@/server/workspace';
import { questionsInput, questionsView, type QuestionsView } from '../domain/questions.ts';

/**
 * The stored result as the browser shows it. The names and the evidence are read only for a stored set, and only
 * after the assessment module authorised the job for the member (`candidate.view`).
 */
export async function viewOf(
  ctx: WorkspaceContext,
  candidateId: string,
  jobId: string,
  result: SuggestedQuestions,
): Promise<QuestionsView> {
  if (result.status !== 'suggested') return { status: result.status };
  const rubric = await getApprovedRubricReads().approvedRubric(ctx.tx, ctx.workspaceId, jobId);
  const evidence = await getEvidence().listEvidenceForCandidate(ctx, candidateId, jobId);
  return questionsView(result, new Map(rubric?.competencies.map((c) => [c.id, c.name])), evidence);
}

/**
 * "Needs live verification" on a candidate's evidence profile (AIV-P1-113): the stored interview questions for the
 * candidate's latest snapshot, read only. No model is called here: questions are asked for on demand
 * (`suggestQuestions`). Null with no workspace, a malformed id, or no result on the approved rubric version; a member
 * not granted the job gets the 403 page (`inActiveWorkspace`).
 */
export async function loadQuestions(candidateId: string, jobId: string | undefined): Promise<QuestionsView | null> {
  const parsed = questionsInput.safeParse({ candidateId, jobId });
  if (!parsed.success) return null;
  const ids = parsed.data;
  const result = await inActiveWorkspace(async (ctx) => {
    const stored = await getAssessment().getSuggestedQuestions(ctx, ids.candidateId, ids.jobId);
    return stored && viewOf(ctx, ids.candidateId, ids.jobId, stored);
  });
  return result && result.value;
}
