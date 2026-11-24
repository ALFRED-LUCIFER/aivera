import { JOB_SCOPED_ROLES } from '@credalent/workspaces';
import { z } from 'zod';
import { getAssessment } from '@/server/assessment';
import { getIntake } from '@/server/intake';
import { getJobs } from '@/server/jobs';
import { inActiveWorkspace } from '@/server/workspace';
import type { Fit, ProfileData } from '../domain/profile.ts';

const ids = z.object({ candidateId: z.uuid(), jobId: z.uuid() });

/**
 * The top of a candidate's evidence profile for one job (AIV-P1-043): who they are, where the application stands, the
 * fit and why they rank there. 'forbidden' when a job-scoped member (hiring owner, interviewer) is not granted the job;
 * 'notFound' for a job or candidate the workspace does not have, a candidate who did not apply to the job, or a
 * malformed id: none says whether the record exists elsewhere. Null with no workspace. Intake and assessment check
 * `candidate.view` on the job themselves; a refusal there renders the 403 page (`inActiveWorkspace`).
 */
// shortcut: the explanation loads with the page, so the first view of a new snapshot waits for the model (cached after,
// AIV-P1-033); stream it under Suspense if pilot recruiters wait on it.
export async function loadProfile(
  candidateId: string,
  jobId: string | undefined,
): Promise<ProfileData | 'notFound' | 'forbidden' | null> {
  const parsed = ids.safeParse({ candidateId, jobId });
  if (!parsed.success) return 'notFound';
  const job = parsed.data.jobId;
  const result = await inActiveWorkspace(async (ctx): Promise<ProfileData | 'notFound' | 'forbidden'> => {
    const found = await getJobs().getJob(ctx, job);
    // Row-level security hides an ungranted job, so a job-scoped member learns nothing about a job they cannot see.
    if (!found) return JOB_SCOPED_ROLES.includes(ctx.role) ? 'forbidden' : 'notFound';
    // shortcut: reads the job's whole applicant list to find one; add a single-application read to intake past ~500.
    const applicant = (await getIntake().listApplicationsForJob(ctx, job)).find((a) => a.personId === candidateId);
    // Not an applicant of this job (or another workspace's person): nothing about them is read.
    if (!applicant) return 'notFound';
    const base = { jobId: job, jobTitle: found.title, name: applicant.displayName, stage: applicant.stage };
    const ranking = await getAssessment().listRanking(ctx, job);
    if (ranking.status === 'awaiting_rubric') return { ...base, fit: { status: 'awaiting_rubric' }, explanation: null };
    const row = ranking.rows.find((r) => r.candidateId === candidateId);
    if (!row) return { ...base, fit: { status: 'not_scored' }, explanation: null };
    const latest = await getAssessment().getLatestAssessment(ctx, candidateId, job);
    const explanation = await getAssessment().explainRanking(ctx, candidateId, job);
    const fit: Fit = {
      status: 'scored',
      rank: row.rank,
      backedScore: row.backedScore,
      upperBound: row.upperBound,
      meetsNeed: row.meetsNeed,
      competencyCount: row.competencyCount,
      ranked: ranking.rows.length,
      // The ranking row is the latest result on the approved version; a result on another version names no claims here.
      openClaims:
        latest?.rubricVersionId === ranking.rubricVersionId
          ? latest.competencies.filter((c) => c.claimedLevel > c.proven.level).length
          : 0,
    };
    return {
      ...base,
      fit,
      explanation: explanation && { source: explanation.source, statements: explanation.statements },
    };
  });
  return result && result.value;
}
