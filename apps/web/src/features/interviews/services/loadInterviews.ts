import { defaultTimeZone } from '@credalent/i18n';
import { scorecardDueDays, type Interview } from '@credalent/interviews';
import { log } from '@credalent/observability';
import type { WorkspaceContext } from '@credalent/workspaces';
import { unstable_rethrow } from 'next/navigation';
import { getIdentity } from '@/server/auth';
import { getIntake } from '@/server/intake';
import { getInterviews } from '@/server/interviews';
import { getApprovedRubricReads, getJobs } from '@/server/jobs';
import { getWorkspaces, inActiveWorkspace } from '@/server/workspace';
import { inListOrder, sameDay, type InterviewRow, type InterviewsData } from '../domain/interviews.ts';
import type { InterviewerOption } from '../domain/schedule.ts';

/**
 * Interviews as list rows: each one's candidate, job, interviewer and competencies by name. Call it only with interviews
 * the interviews contract returned for `ctx` (`listInterviews`, `getInterview`): it has authorised their jobs, which is
 * what lets the unauthorised rubric read below run. Intake and jobs check the member's job scope again themselves.
 */
export async function toInterviewRows(
  ctx: WorkspaceContext,
  interviews: Interview[],
  now: Date,
): Promise<InterviewRow[]> {
  type JobNames = {
    title: string;
    /** Applicant names by application id. */
    names: Map<string, string | null>;
    rubric: { id: string; names: Map<string, string> } | null;
  };
  const jobs = new Map<string, JobNames>();
  // One after another: they share the request's one transaction.
  for (const jobId of new Set(interviews.map((i) => i.jobId))) {
    const job = await getJobs().getJob(ctx, jobId);
    const applicants = await getIntake().listApplicationsForJob(ctx, jobId);
    const rubric = await getApprovedRubricReads().approvedRubric(ctx.tx, ctx.workspaceId, jobId);
    jobs.set(jobId, {
      title: job?.title ?? '',
      names: new Map(applicants.map((a) => [a.applicationId, a.displayName])),
      rubric: rubric && { id: rubric.id, names: new Map(rubric.competencies.map((c) => [c.id, c.name])) },
    });
  }
  // Named as My desk names a hiring owner: their title in the workspace, else their name.
  // shortcut: one membership and identity read per distinct interviewer; batch it past a few dozen interviewers.
  const interviewers = new Map(
    await Promise.all(
      [...new Set(interviews.map((i) => i.interviewerUserId))]
        .filter((id) => id !== ctx.userId)
        .map(async (id) => {
          const title = (await getWorkspaces().getMembership(id, ctx.workspaceId))?.title;
          const user = title ? null : await getIdentity().getUser(id);
          return [id, title || user?.displayName || user?.email || ''] as const;
        }),
    ),
  );
  return interviews.map((i) => {
    const job = jobs.get(i.jobId);
    const rubric = job?.rubric?.id === i.rubricVersionId ? job.rubric.names : null;
    return {
      id: i.id,
      candidate: job?.names.get(i.applicationId) ?? null,
      job: job?.title ?? '',
      round: i.round,
      interviewer: i.interviewerUserId === ctx.userId ? null : (interviewers.get(i.interviewerUserId) ?? ''),
      interviewerUserId: i.interviewerUserId,
      scheduledAt: i.scheduledAt?.toISOString() ?? null,
      today: !!i.scheduledAt && sameDay(i.scheduledAt, now, defaultTimeZone),
      status: i.status,
      dueDays:
        i.status === 'scorecard_due' && i.scheduledAt ? scorecardDueDays(i.scheduledAt, now, defaultTimeZone) : null,
      // shortcut: names come from the job's approved rubric now; an interview planned on a version since replaced
      // lists none. Read competencies by version when the jobs contract offers it.
      competencies: i.competencyIds.flatMap((id) => rubric?.get(id) ?? []),
    };
  });
}

/**
 * The active members a recruiter may pick as interviewer, by name (AIV-P2-007). The module refuses one the job does
 * not grant, so the dialog says "The interviewer must be an active member who can see this job" for them.
 */
async function interviewerOptions(ctx: WorkspaceContext): Promise<InterviewerOption[]> {
  const members = (await getWorkspaces().listMembers(ctx)).filter((m) => m.status === 'active');
  // shortcut: one identity read per member; a batch read in identity when a workspace has more than a handful.
  const options = await Promise.all(
    members.map(async ({ userId }) => {
      const user = await getIdentity().getUser(userId, ctx);
      return user && { value: userId, label: user.displayName ?? user.email };
    }),
  );
  return options.filter((o) => o !== null).toSorted((a, b) => a.label.localeCompare(b.label));
}

/**
 * The Interviews page (AIV-P2-002): the ongoing and completed interviews the member may see, through `listInterviews`,
 * which checks `interview.view`, the member's job scope and, for an interviewer, that the interview is theirs. Null
 * with no workspace. The summary counts are of what this member sees.
 */
export async function loadInterviews(): Promise<InterviewsData | null> {
  const now = new Date();
  const result = await inActiveWorkspace(async (ctx) => {
    const completed = await getInterviews().listInterviews(ctx, 'completed');
    return {
      ongoing: inListOrder(await toInterviewRows(ctx, await getInterviews().listInterviews(ctx, 'ongoing'), now)),
      completed: await toInterviewRows(ctx, completed, now),
      people: new Set(completed.map((i) => i.candidateId)).size,
      jobs: new Set(completed.map((i) => i.jobId)).size,
      interviewers: ctx.role === 'admin' || ctx.role === 'recruiter' ? await interviewerOptions(ctx) : null,
    };
  });
  return result && result.value;
}

/**
 * The sidebar's Interviews count: the member's ongoing interviews, the same list the page's "Ongoing" tab shows. Null
 * with no workspace, or when the read fails: the shell then shows no count rather than break every page.
 */
export async function countOngoingInterviews(): Promise<number | null> {
  try {
    const result = await inActiveWorkspace((ctx) => getInterviews().listInterviews(ctx, 'ongoing'));
    return result && result.value.length;
  } catch (error) {
    // Next's redirect (no session) and 403 signals pass through.
    unstable_rethrow(error);
    log.error({ area: 'interviews', 'error.type': error instanceof Error ? error.name : 'unknown' }, 'count failed');
    return null;
  }
}
