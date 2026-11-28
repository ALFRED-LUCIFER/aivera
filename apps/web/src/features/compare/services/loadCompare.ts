import { JOB_SCOPED_ROLES } from '@credalent/workspaces';
import { z } from 'zod';
import { evidenceCards } from '@/features/evidence-profile/domain/evidenceCards.ts';
import { jobPageHref } from '@/features/job-header/domain/jobHeader.ts';
import { toCandidateRows } from '@/features/ranking/domain/ranking.ts';
import { bulkActionsFor } from '@/features/ranking/domain/selection.ts';
import { getDecisions } from '@/server/decisions';
import { enabledFlags } from '@/server/flags';
import { getAssessment } from '@/server/assessment';
import { getEvidence } from '@/server/evidence';
import { getIntake } from '@/server/intake';
import { getApprovedRubricReads, getJobs } from '@/server/jobs';
import { inActiveWorkspace } from '@/server/workspace';
import {
  MAX_COMPARE,
  MIN_COMPARE,
  cellOf,
  parseIds,
  type CompareColumn,
  type CompareData,
  type CompareRow,
} from '../domain/compare.ts';

/**
 * The comparison of a job's candidates (AIV-P1-047): the approved rubric's competencies, heaviest first, and for each
 * chosen candidate their backed score and what each competency's level rests on, from their stored assessment and the
 * evidence it cites. Nothing is scored or ranked here. 'forbidden' when a job-scoped member (hiring owner, interviewer)
 * is not granted the job; 'notFound' for a job the workspace does not have or a malformed id or id list: neither says
 * whether a record exists elsewhere. `tooFew` outside 2 to 10 candidates; `notOnJob` when one is not an applicant of
 * this job, and then nothing about anyone is read. Null with no workspace. Jobs, intake, assessment and evidence each
 * check the member's access to the job themselves; a refusal there renders the 403 page (`inActiveWorkspace`).
 */
// shortcut: two reads per candidate (assessment, evidence), at most 20 a page; add a by-job read if the limit grows.
export async function loadCompare(
  jobId: string,
  idsParam: unknown,
): Promise<CompareData | 'notFound' | 'forbidden' | null> {
  const ids = parseIds(idsParam);
  if (!z.uuid().safeParse(jobId).success || !ids) return 'notFound';
  const result = await inActiveWorkspace(async (ctx): Promise<CompareData | 'notFound' | 'forbidden'> => {
    const job = await getJobs().getJob(ctx, jobId);
    // Row-level security hides an ungranted job, so a job-scoped member learns nothing about a job they cannot see.
    if (!job) return JOB_SCOPED_ROLES.includes(ctx.role) ? 'forbidden' : 'notFound';
    const applicants = new Map((await getIntake().listApplicationsForJob(ctx, jobId)).map((a) => [a.personId, a]));
    const chosen = ids.flatMap((id) => applicants.get(id) ?? []);
    const base = {
      jobId,
      jobTitle: job.title,
      // The ranking's `selected` holds application ids; only this job's are named.
      selectionHref: `${jobPageHref(jobId, 'candidates')}?selected=${chosen.map((a) => a.applicationId).join(',')}`,
    };
    // SAFETY: someone who is not an applicant of this job (or is another workspace's person) is never read.
    if (chosen.length !== ids.length) return { ...base, status: 'notOnJob' };
    if (ids.length < MIN_COMPARE || ids.length > MAX_COMPARE) return { ...base, status: 'tooFew' };

    const ranking = await getAssessment().listRanking(ctx, jobId);
    const versionId = ranking.status === 'awaiting_rubric' ? null : ranking.rubricVersionId;
    // Not authorised itself: `getJob` and `listRanking` above authorised this job for the member (as loadProfile does).
    const rubric = versionId && (await getApprovedRubricReads().approvedRubric(ctx.tx, ctx.workspaceId, jobId));
    const approved = rubric && rubric.id === versionId;
    // The version's number ("rubric v2") is on the jobs contract's read, which has no competency ids.
    const numbered = approved ? await getJobs().getApprovedRubric(ctx, jobId) : null;
    const rows: CompareRow[] = approved
      ? rubric.competencies
          .toSorted((a, b) => b.weightPercent - a.weightPercent)
          .map((c) => ({ competencyId: c.id, name: c.name, weightPercent: c.weightPercent, needed: c.levelNeeded }))
      : [];
    const names = new Map(rows.map((r) => [r.competencyId, r.name]));
    const columns: CompareColumn[] = [];
    for (const { personId, displayName } of chosen) {
      const row =
        ranking.status === 'awaiting_rubric' ? undefined : ranking.rows.find((r) => r.candidateId === personId);
      const latest = row && (await getAssessment().getLatestAssessment(ctx, personId, jobId));
      // The ranking row is the latest result on the approved version; a result on another version fills no cell.
      const results = latest && latest.rubricVersionId === versionId ? latest.competencies : [];
      const evidence = results.length ? await getEvidence().listEvidenceForCandidate(ctx, personId, jobId) : [];
      // No file is linked from this page, for anyone (AGENTS.md 1.9).
      const cards = new Map(evidenceCards(results, names, evidence, false).map((card) => [card.competencyId, card]));
      columns.push({
        candidateId: personId,
        name: displayName,
        score: row ? { backed: row.backedScore, upTo: row.upperBound } : null,
        cells: Object.fromEntries(
          results.map((r) => [r.competencyId, cellOf(r.proven.level, cards.get(r.competencyId))]),
        ),
      });
    }
    // `pack.view`: admins, recruiters and hiring owners; an interviewer may not read packs (as the job header does).
    const packs = ctx.role === 'interviewer' ? [] : await getDecisions().listPacks(ctx, jobId);
    // Decided here from the member's role, not in the browser (AGENTS.md 1.3); the action re-checks on Confirm.
    const mayAdd = bulkActionsFor(ctx.role, enabledFlags).includes('addToPack');
    return {
      ...base,
      status: 'ready',
      preparedAt: new Date(),
      rubricVersion: numbered?.id === versionId ? numbered.version : null,
      rows,
      columns,
      hasPack: packs.some((p) => p.candidateIds.length > 0),
      pack: mayAdd
        ? {
            rows: toCandidateRows(chosen, ranking.status === 'ranked' ? ranking.rows : [], (id) => names.get(id)),
            packs: packs
              .filter((p) => p.status === 'ready')
              .map(({ id, name, candidateIds }) => ({ id, name, candidateIds })),
          }
        : null,
    };
  });
  return result && result.value;
}
