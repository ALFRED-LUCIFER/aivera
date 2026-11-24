import type { Tx } from '@credalent/db';
import {
  ForbiddenError,
  JOB_SCOPED_ROLES,
  type Action,
  type JobResource,
  type WorkspaceContext,
} from '@credalent/workspaces';
import { z } from 'zod';
import {
  canMove,
  effectiveStatus,
  InterviewError,
  ONGOING,
  ROUNDS,
  type Interview,
  type InterviewStatus,
} from '../domain/interview.ts';

/** The store over one workspace-scoped transaction. Every method filters by `workspaceId`. */
export type InterviewStore = {
  insert(interview: Interview): Promise<void>;
  find(workspaceId: string, interviewId: string): Promise<Interview | null>;
  /** Moves the stored status only while it is still `from`, so two concurrent moves cannot both apply. */
  moveStatus(workspaceId: string, interviewId: string, from: InterviewStatus, to: InterviewStatus): Promise<boolean>;
  /** Interviews with a stored status in `statuses`, soonest first and those with no time last; one interviewer's if given. */
  list(workspaceId: string, statuses: readonly InterviewStatus[], interviewerUserId?: string): Promise<Interview[]>;
};

export type Ports = {
  storeFor(tx: Tx): InterviewStore;
  /** Writes `InterviewScheduled.v1` to the outbox in `tx`, so it commits only with the interview (AIV-P0-014). */
  publishInterviewScheduled(tx: Tx, interview: Interview): Promise<void>;
  authorize(ctx: WorkspaceContext, action: Action, resource?: JobResource): Promise<void>;
  /** The job and its client, or null when the context cannot see it (the jobs contract's `getJob`, under RLS). */
  jobResource(ctx: WorkspaceContext, jobId: string): Promise<JobResource | null>;
  /** The application's person and job, or null (intake's unauthorised read: called before authorising its job). */
  findApplication(
    tx: Tx,
    workspaceId: string,
    applicationId: string,
  ): Promise<{ personId: string; jobId: string } | null>;
  /** The job's approved rubric version and its competency ids, or null (the jobs module's unauthorised read). */
  approvedRubric(
    tx: Tx,
    workspaceId: string,
    jobId: string,
  ): Promise<{ id: string; competencies: { id: string }[] } | null>;
  /** Whether `userId` is an active member who can see the job: admin or recruiter, or granted the job or its client. */
  canInterview(ctx: WorkspaceContext, userId: string, job: JobResource): Promise<boolean>;
  newId(): string;
  now(): Date;
};

/** Validated in the use case, whatever the caller (a server action, intake's choose-for-interview) checked (AGENTS.md 3.7). */
export const createInterviewInputSchema = z.strictObject({
  applicationId: z.uuid(),
  round: z.enum(ROUNDS),
  interviewerUserId: z.uuid(),
  /** Omitted or null: the interview has no time yet (`to_schedule`). */
  scheduledAt: z.date().nullable().optional(),
  competencyIds: z.array(z.uuid()).max(50),
});
export type CreateInterviewInput = z.input<typeof createInterviewInputSchema>;

export type InterviewFilter = 'ongoing' | 'completed';

// Interviewers see and run only their own interviews ("see the candidates you interview"); hiring owners see their jobs'.
const ownOnly = (ctx: WorkspaceContext) => ctx.role === 'interviewer';

export function interviewUseCases(ports: Ports) {
  const { storeFor, authorize, jobResource, now } = ports;
  const shown = (interview: Interview): Interview => ({ ...interview, status: effectiveStatus(interview, now()) });

  /** The stored interview when the context may see it: its job visible and, for an interviewer, their own. */
  async function visible(ctx: WorkspaceContext, interviewId: string) {
    const interview = await storeFor(ctx.tx).find(ctx.workspaceId, interviewId);
    if (!interview || (ownOnly(ctx) && interview.interviewerUserId !== ctx.userId)) return null;
    // The job comes from the stored interview, never the request; one the context cannot see hides the interview.
    const job = await jobResource(ctx, interview.jobId);
    return job && { interview, job };
  }

  return {
    async createInterview(ctx: WorkspaceContext, raw: CreateInterviewInput): Promise<{ interviewId: string }> {
      const input = createInterviewInputSchema.parse(raw);
      const application = await ports.findApplication(ctx.tx, ctx.workspaceId, input.applicationId);
      // The job comes from the stored application: a job the context cannot see reads as no application.
      const job = application && (await jobResource(ctx, application.jobId));
      if (!application || !job) throw new InterviewError('application_not_found');
      await authorize(ctx, 'interview.schedule', job);
      const rubric = await ports.approvedRubric(ctx.tx, ctx.workspaceId, job.jobId);
      if (!rubric) throw new InterviewError('rubric_not_approved');
      const inRubric = new Set(rubric.competencies.map((c) => c.id));
      const competencyIds = [...new Set(input.competencyIds)];
      if (!competencyIds.every((id) => inRubric.has(id))) throw new InterviewError('competency_not_in_rubric');
      if (!(await ports.canInterview(ctx, input.interviewerUserId, job)))
        throw new InterviewError('interviewer_not_on_job');
      const scheduledAt = input.scheduledAt ?? null;
      const interview: Interview = {
        id: ports.newId(),
        workspaceId: ctx.workspaceId,
        applicationId: input.applicationId,
        jobId: job.jobId,
        candidateId: application.personId,
        round: input.round,
        interviewerUserId: input.interviewerUserId,
        scheduledAt,
        status: scheduledAt ? 'scheduled' : 'to_schedule',
        rubricVersionId: rubric.id,
        competencyIds,
        createdBy: ctx.userId,
        createdAt: now(),
      };
      await storeFor(ctx.tx).insert(interview);
      if (scheduledAt) await ports.publishInterviewScheduled(ctx.tx, interview);
      return { interviewId: interview.id };
    },

    async startInterview(ctx: WorkspaceContext, interviewId: string): Promise<void> {
      const found = await visible(ctx, interviewId);
      if (!found) throw new InterviewError('interview_not_found');
      const { interview, job } = found;
      await authorize(ctx, 'interview.conduct', job);
      // A hiring owner or interviewer runs only the interviews they are the interviewer on.
      if (JOB_SCOPED_ROLES.includes(ctx.role) && interview.interviewerUserId !== ctx.userId) throw new ForbiddenError();
      if (!canMove(effectiveStatus(interview, now()), 'in_progress')) throw new InterviewError('status_move');
      if (!(await storeFor(ctx.tx).moveStatus(ctx.workspaceId, interviewId, interview.status, 'in_progress')))
        throw new InterviewError('status_move');
    },

    async getInterview(ctx: WorkspaceContext, interviewId: string): Promise<Interview | null> {
      const found = await visible(ctx, interviewId);
      if (!found) return null;
      await authorize(ctx, 'interview.view', found.job);
      return shown(found.interview);
    },

    // shortcut: no paging; a pilot workspace holds tens of interviews, page here past ~500.
    async listInterviews(ctx: WorkspaceContext, filter: InterviewFilter): Promise<Interview[]> {
      const rows = await storeFor(ctx.tx).list(
        ctx.workspaceId,
        filter === 'ongoing' ? ONGOING : ['completed'],
        ownOnly(ctx) ? ctx.userId : undefined,
      );
      // Each job checked once against the context: one it cannot see (not granted) drops its interviews.
      const seen = new Map<string, boolean>();
      for (const jobId of new Set(rows.map((r) => r.jobId))) {
        const job = await jobResource(ctx, jobId);
        if (job) await authorize(ctx, 'interview.view', job);
        seen.set(jobId, !!job);
      }
      return rows.filter((r) => seen.get(r.jobId)).map(shown);
    },
  };
}
