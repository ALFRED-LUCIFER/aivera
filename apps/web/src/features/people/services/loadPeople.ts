import { getAssessment } from '@/server/assessment';
import { getDecisions } from '@/server/decisions';
import { getIntake } from '@/server/intake';
import { getJobs } from '@/server/jobs';
import { inActiveWorkspace } from '@/server/workspace';
import { defaultTimeZone } from '@credalent/i18n';
import { sameDay } from '@/features/interviews/domain/interviews.ts';
import { currentInterviews, toCandidateRows, withInterview } from '@/features/ranking/domain/ranking.ts';
import { getInterviews } from '@/server/interviews';
import { toPeople, type PeopleData } from '../domain/people.ts';

/**
 * Candidates (all jobs), AIV-P1-048: each open job's assessed applicants, as its ranking lists them, folded into one row
 * per person. Only the active workspace's jobs and people are read: the request context sets the workspace, and
 * row-level security and each contract's job scope hold it (ADR-005). Null with no workspace.
 */
export async function loadPeople(): Promise<PeopleData | null> {
  const result = await inActiveWorkspace(async (ctx) => {
    const jobs = (await getJobs().listJobs(ctx)).filter((job) => job.stage !== 'closed');
    // Each application's current round (AIV-P2-007), from the interviews the member may see.
    const now = new Date();
    const interviews = currentInterviews(
      [
        ...(await getInterviews().listInterviews(ctx, 'ongoing')),
        ...(await getInterviews().listInterviews(ctx, 'completed')),
      ],
      (at) => sameDay(at, now, defaultTimeZone),
    );
    const lists = [];
    // shortcut: three reads per job in one transaction; add one cross-job read to intake and assessment when a
    // workspace runs dozens of open jobs.
    for (const job of jobs) {
      const ranking = await getAssessment().listRanking(ctx, job.id);
      // Never ranked from a draft rubric: nobody on this job is assessed yet.
      if (ranking.status !== 'ranked') continue;
      const applicants = await getIntake().listApplicationsForJob(ctx, job.id);
      const inPack = new Set(
        (await getDecisions().listPacks(ctx, job.id))
          .filter((pack) => pack.status === 'ready')
          .flatMap((pack) => pack.candidateIds),
      );
      // Competency names are not shown here, so none are resolved.
      const rows = toCandidateRows(applicants, ranking.rows, () => undefined).map((row) =>
        withInterview(inPack.has(row.personId) ? { ...row, inPack: true as const } : row, interviews),
      );
      lists.push({ id: job.id, title: job.title, rows });
    }
    return lists;
  });
  return result && toPeople(result.value);
}
