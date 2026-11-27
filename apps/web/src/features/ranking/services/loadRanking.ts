import type { PersonMergeSummary } from '@credalent/candidates';
import { defaultTimeZone } from '@credalent/i18n';
import { sameDay } from '@/features/interviews/domain/interviews.ts';
import { IntakeError, type Source, type Stage } from '@credalent/intake';
import { log } from '@credalent/observability';
import { ForbiddenError, type WorkspaceContext } from '@credalent/workspaces';
import { z } from 'zod';
import { getAssessment } from '@/server/assessment';
import { getDecisions } from '@/server/decisions';
import { enabledFlags } from '@/server/flags';
import { getCandidates } from '@/server/people';
import { getIntake } from '@/server/intake';
import { getInterviews } from '@/server/interviews';
import { getApprovedRubricReads, getJobs } from '@/server/jobs';
import { inActiveWorkspace } from '@/server/workspace';
import type { MergeSide, RowDuplicates } from '../domain/duplicates.ts';
import { currentInterviews, toCandidateRows, withInterview, type RankingData } from '../domain/ranking.ts';
import { bulkActionsFor } from '../domain/selection.ts';

/**
 * The applicants' duplicates (AIV-P1-018), for admins and recruiters only: the merged count, the newest undoable merge
 * (admins), and the possible duplicate with the preview of what a merge combines. Keyed by person id.
 */
async function duplicatesOf(ctx: WorkspaceContext, personIds: string[]) {
  const found = new Map<string, RowDuplicates>();
  if (ctx.role !== 'admin' && ctx.role !== 'recruiter') return found;
  const candidates = getCandidates();
  let titles: Map<string, string> | undefined;
  /** One side of the preview; `survivor` is the other side's applications, for the jobs both applied to. */
  const side = async (
    { displayName, applications, evidenceSources }: PersonMergeSummary,
    survivor?: PersonMergeSummary,
  ): Promise<MergeSide> => {
    titles ??= new Map((await getJobs().listJobs(ctx)).map((j) => [j.id, j.title]));
    return {
      name: displayName,
      // Intake's stages and channels are its STAGES and SOURCES; the summary keeps them as plain strings across the
      // module boundary.
      applications: applications.map((a) => ({
        job: titles?.get(a.jobId) ?? '',
        stage: a.stage as Stage,
        sources: a.sources as Source[],
        // Both applied to this job: the applications become the survivor's one, at the survivor's stage.
        keepsStage: (survivor?.applications.find((s) => s.jobId === a.jobId)?.stage as Stage | undefined) ?? null,
      })),
      evidenceSources,
    };
  };
  for (const report of await candidates.detectDuplicates(ctx, personIds)) {
    const [possible] = report.possible;
    const undoable = ctx.role === 'admin' ? report.merged.findLast((m) => m.undoable) : undefined;
    if (!possible && report.merged.length === 0) continue;
    const preview = possible && (await candidates.previewMerge(ctx, possible.personId, report.personId));
    found.set(report.personId, {
      personId: report.personId,
      mergedCount: report.merged.length,
      undo: undoable ? { mergeId: undoable.mergeId, name: undoable.displayName } : null,
      possible:
        possible && preview
          ? {
              personId: possible.personId,
              name: possible.displayName,
              reason: possible.reason,
              survivor: await side(preview.survivor),
              merged: await side(preview.merged, preview.survivor),
            }
          : null,
    });
  }
  return found;
}

/**
 * Each application's current interview round (AIV-P2-007), from the interviews the member may see: the contract checks
 * `interview.view` and job scope, and gives an interviewer only their own.
 */
async function interviewsOf(ctx: WorkspaceContext) {
  const interviews = getInterviews();
  const now = new Date();
  return currentInterviews(
    [...(await interviews.listInterviews(ctx, 'ongoing')), ...(await interviews.listInterviews(ctx, 'completed'))],
    (at) => sameDay(at, now, defaultTimeZone),
  );
}

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
      const duplicates = await duplicatesOf(ctx, [...new Set(applicants.map((a) => a.personId))]);
      const interviews = await interviewsOf(ctx);
      // Decided here from the member's role, not in the browser (AGENTS.md 1.3).
      const bulkActions = bulkActionsFor(ctx.role, enabledFlags);
      if (ranking.status === 'awaiting_rubric')
        return { applicants, ranking, names: new Map<string, string>(), duplicates, bulkActions, interviews };
      // Read only after listRanking authorised the job. The ranking is on the approved version; names from another
      // version are never shown against it.
      const rubric = await getApprovedRubricReads().approvedRubric(ctx.tx, ctx.workspaceId, jobId);
      const names = new Map(
        rubric?.id === ranking.rubricVersionId ? rubric.competencies.map((c) => [c.id, c.name] as const) : [],
      );
      // shortcut: only members who may add to a pack read the packs, so a hiring owner's rows do not say "In shortlist
      // pack"; read them for `pack.view` too when the hiring owner's ranking needs it.
      const packs = bulkActions.includes('addToPack')
        ? (await getDecisions().listPacks(ctx, jobId))
            .filter((p) => p.status === 'ready')
            .map(({ id, name, candidateIds }) => ({ id, name, candidateIds }))
        : [];
      return { applicants, ranking, names, duplicates, bulkActions, packs, interviews };
    });
    if (!result) return null;
    const { applicants, ranking, names, duplicates, bulkActions, interviews } = result.value;
    const packs = 'packs' in result.value ? result.value.packs : [];
    const inPack = new Set(packs.flatMap((p) => p.candidateIds));
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
      rows: toCandidateRows(applicants, ranked, (id) => names.get(id), duplicates).map((row) =>
        withInterview(inPack.has(row.personId) ? { ...row, inPack: true as const } : row, interviews),
      ),
      bulkActions,
      ...(bulkActions.includes('addToPack') && { packs }),
    };
  } catch (error) {
    if (error instanceof IntakeError || error instanceof ForbiddenError) return 'notFound';
    throw error;
  }
}
