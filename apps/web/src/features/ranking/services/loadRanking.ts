import { IntakeError } from '@credalent/intake';
import { log } from '@credalent/observability';
import { ForbiddenError } from '@credalent/workspaces';
import { z } from 'zod';
import { getAssessment } from '@/server/assessment';
import { getIntake } from '@/server/intake';
import { getApprovedRubricReads } from '@/server/jobs';
import { inActiveWorkspace } from '@/server/workspace';
import { toCandidateRows, type RankingData } from '../domain/ranking.ts';

/**
 * The ranked candidates page (AIV-P1-034): the job's applicants from intake joined to assessment's ranking, both of
 * which check `candidate.view` on the job and the member's job scope. 'notFound' for a job the member cannot see or a
 * malformed id; null with no workspace. The log line carries ids and counts, never a name or a score.
 */
export async function loadRanking(jobId: string): Promise<RankingData | 'notFound' | null> {
  // The layout runs alongside this page, so a malformed id must not reach the database from here either.
  if (!z.uuid().safeParse(jobId).success) return 'notFound';
  try {
    const result = await inActiveWorkspace(async (ctx) => {
      const applicants = await getIntake().listApplicationsForJob(ctx, jobId);
      const ranking = await getAssessment().listRanking(ctx, jobId);
      if (ranking.status === 'awaiting_rubric') return { applicants, ranking, names: new Map<string, string>() };
      // Read only after listRanking authorised the job. The ranking is on the approved version; names from another
      // version are never shown against it.
      const rubric = await getApprovedRubricReads().approvedRubric(ctx.tx, ctx.workspaceId, jobId);
      const names = new Map(
        rubric?.id === ranking.rubricVersionId ? rubric.competencies.map((c) => [c.id, c.name] as const) : [],
      );
      return { applicants, ranking, names };
    });
    if (!result) return null;
    const { applicants, ranking, names } = result.value;
    const ranked = ranking.status === 'ranked' ? ranking.rows : [];
    log.info(
      {
        area: 'candidates',
        jobId,
        'credalent.intake.applications': applicants.length,
        'credalent.assessment.ranked': ranked.length,
      },
      'ranking listed',
    );
    return {
      jobId,
      awaitingRubric: ranking.status === 'awaiting_rubric',
      rows: toCandidateRows(applicants, ranked, (id) => names.get(id)),
    };
  } catch (error) {
    if (error instanceof IntakeError || error instanceof ForbiddenError) return 'notFound';
    throw error;
  }
}
