// Builds the interviews module for an app (ADR-002: only apps and test suites import this).
import { enqueue } from '@credalent/db/outbox';
import { uuidv7 } from '@credalent/db/uuidv7';
import type { ApprovedRubricReads, JobsContract } from '@credalent/jobs';
import { grantsCover, JOB_SCOPED_ROLES, type WorkspacesContract } from '@credalent/workspaces';
import { interviewUseCases, type Ports } from './application/interviews.ts';
import { InterviewScheduledV1, type InterviewsContract } from './contracts/index.ts';
import { interviewStore } from './infrastructure/repository.ts';
import { outbox } from './infrastructure/schema.ts';

/**
 * `approvedRubric` is the jobs composition's `createApprovedRubricReads().approvedRubric`; `findApplication` is the intake
 * composition's `findApplication`. Both are unauthorised reads this module calls only for the job it then authorises.
 * Taken as functions, not modules, so intake can call this contract (AIV-P1-114) without a package cycle.
 * `now` is the injected clock (AGENTS.md 3.9); tests pass a fixed one.
 */
export function createInterviews(
  workspaces: Pick<WorkspacesContract, 'authorize' | 'listMembers' | 'listJobGrants'>,
  jobs: Pick<JobsContract, 'getJob'>,
  approvedRubric: ApprovedRubricReads['approvedRubric'],
  findApplication: Ports['findApplication'],
  now: () => Date = () => new Date(),
): InterviewsContract {
  return interviewUseCases({
    storeFor: interviewStore,
    publishInterviewScheduled: (tx, interview) =>
      enqueue(tx, outbox, InterviewScheduledV1, {
        workspaceId: interview.workspaceId,
        payload: { interviewId: interview.id, applicationId: interview.applicationId },
        dedupeKey: `interview-scheduled:${interview.id}`,
        occurredAt: interview.createdAt,
      }),
    authorize: (ctx, action, resource) => workspaces.authorize(ctx, action, resource),
    jobResource: async (ctx, jobId) => {
      const job = await jobs.getJob(ctx, jobId);
      return job && { jobId: job.id, clientId: job.clientId };
    },
    findApplication,
    approvedRubric,
    async canInterview(ctx, userId, job) {
      const member = (await workspaces.listMembers(ctx)).find((m) => m.userId === userId);
      if (member?.status !== 'active') return false;
      if (!JOB_SCOPED_ROLES.includes(member.role)) return true;
      // Read only by admins and recruiters (job_access.view), the roles createInterview has already authorised.
      const grants = (await workspaces.listJobGrants(ctx)).filter((g) => g.userId === userId);
      return grantsCover(grants, job);
    },
    newId: () => uuidv7(),
    now,
  });
}
