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
  clashingAt,
  effectiveStatus,
  InterviewError,
  ONGOING,
  ROUNDS,
  type Interview,
  type InterviewStatus,
} from '../domain/interview.ts';
import { scorecardDraftSchema, type ScorecardDraft } from '../domain/scorecard.ts';

/** The store over one workspace-scoped transaction. Every method filters by `workspaceId`. */
export type InterviewStore = {
  insert(interview: Interview): Promise<void>;
  find(workspaceId: string, interviewId: string): Promise<Interview | null>;
  /** Moves the stored status only while it is still `from`, so two concurrent moves cannot both apply. */
  moveStatus(workspaceId: string, interviewId: string, from: InterviewStatus, to: InterviewStatus): Promise<boolean>;
  /**
   * Sets the time and interviewer while the stored status is still `from` (so a concurrent start or cancel wins), and
   * makes it `scheduled`.
   */
  schedule(
    workspaceId: string,
    interviewId: string,
    from: InterviewStatus,
    scheduledAt: Date,
    interviewerUserId: string,
  ): Promise<boolean>;
  /** Interviews with a stored status in `statuses`, soonest first and those with no time last; one interviewer's if given. */
  list(workspaceId: string, statuses: readonly InterviewStatus[], interviewerUserId?: string): Promise<Interview[]>;
  findDraft(workspaceId: string, interviewId: string): Promise<ScorecardDraft | null>;
  /** Stores the interview's one draft, replacing an earlier one. */
  saveDraft(
    row: ScorecardDraft & { workspaceId: string; interviewId: string; updatedBy: string; updatedAt: Date },
  ): Promise<void>;
  /** Deletes every interview of the workspace, and with each its scorecard draft. */
  deleteAll(workspaceId: string): Promise<void>;
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
  isSyntheticWorkspace(ctx: WorkspaceContext): Promise<boolean>;
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

export const scheduleInterviewInputSchema = z.strictObject({
  interviewId: z.uuid(),
  scheduledAt: z.date(),
  interviewerUserId: z.uuid(),
  /** The person saw the clash warning and chose to keep the time (AIV-P2-007 "can still choose to keep it"). */
  keepClash: z.boolean().default(false),
});
export type ScheduleInterviewInput = z.input<typeof scheduleInterviewInputSchema>;

/** Scheduled, or not yet: the interviewer already has an interview at `clashAt`, and nothing was written. */
export type ScheduleResult = { status: 'scheduled' } | { status: 'clash'; clashAt: Date };

export type InterviewFilter = 'ongoing' | 'completed';

/** An interview with its scorecard draft, for a member who may see the interview. */
export type Scorecard = {
  interview: Interview;
  /** Whether this member may change the draft now: its interviewer or an admin, while the interview is open. */
  canEdit: boolean;
  /** Null when nothing is saved yet, and always for a member who is neither its interviewer nor an admin. */
  draft: ScorecardDraft | null;
};

// Interviewers see and run only their own interviews ("see the candidates you interview"); hiring owners see their jobs'.
const ownOnly = (ctx: WorkspaceContext) => ctx.role === 'interviewer';

// SAFETY: a draft is its interviewer's unsubmitted word about a candidate: only they, or a workspace admin, hold it.
const holdsScorecard = (ctx: WorkspaceContext, interview: Interview) =>
  ctx.role === 'admin' || interview.interviewerUserId === ctx.userId;

/**
 * The stored interview for the person who holds its scorecard (`holdsScorecard`), on a job they can reach, authorised
 * `scorecard.submit`; throws for anyone else, reading nothing more. Saving a draft and previewing its ratings
 * (AIV-P2-005) share it.
 */
export async function scorecardHolder(
  ports: Pick<Ports, 'storeFor' | 'jobResource' | 'authorize'>,
  ctx: WorkspaceContext,
  interviewId: string,
): Promise<Interview> {
  const interview = await ports.storeFor(ctx.tx).find(ctx.workspaceId, interviewId);
  if (!interview) throw new InterviewError('interview_not_found');
  if (!holdsScorecard(ctx, interview)) throw new ForbiddenError();
  // SAFETY: the job comes from the stored interview. One the member cannot reach (a hiring owner or interviewer
  // with no grant on it, ADR-005 point 6) is refused, even for the interview's own interviewer.
  const job = await ports.jobResource(ctx, interview.jobId);
  if (!job) throw new ForbiddenError();
  await ports.authorize(ctx, 'scorecard.submit', job);
  return interview;
}

const open = (interview: Interview) => interview.status !== 'completed' && interview.status !== 'cancelled';

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
    async getScorecard(ctx: WorkspaceContext, interviewId: string): Promise<Scorecard | null> {
      const found = await visible(ctx, interviewId);
      if (!found) return null;
      await authorize(ctx, 'interview.view', found.job);
      const holds = holdsScorecard(ctx, found.interview);
      return {
        interview: shown(found.interview),
        canEdit: holds && open(found.interview),
        draft: holds ? await storeFor(ctx.tx).findDraft(ctx.workspaceId, interviewId) : null,
      };
    },

    async saveScorecardDraft(ctx: WorkspaceContext, interviewId: string, raw: ScorecardDraft): Promise<void> {
      const draft = scorecardDraftSchema.parse(raw);
      const interview = await scorecardHolder(ports, ctx, interviewId);
      if (interview.status === 'completed') throw new InterviewError('scorecard_submitted');
      if (!open(interview)) throw new InterviewError('scorecard_closed');
      const ids = draft.competencies.map((c) => c.competencyId);
      if (new Set(ids).size !== ids.length || !ids.every((id) => interview.competencyIds.includes(id)))
        throw new InterviewError('competency_not_in_interview');
      // A draft's questions are stored as the browser sent them; the submit (AIV-P2-006) rebuilds them on the questions
      // the page shows before it reads `assessedRatings`, so a made-up question never leaves a competency unscored.
      await storeFor(ctx.tx).saveDraft({
        ...draft,
        workspaceId: ctx.workspaceId,
        interviewId,
        updatedBy: ctx.userId,
        updatedAt: now(),
      });
    },

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

    async scheduleInterview(ctx: WorkspaceContext, raw: ScheduleInterviewInput): Promise<ScheduleResult> {
      const input = scheduleInterviewInputSchema.parse(raw);
      const interview = await storeFor(ctx.tx).find(ctx.workspaceId, input.interviewId);
      // The job comes from the stored interview; one the context cannot see hides the interview. Authorised before
      // anything else, so a granted interviewer or hiring owner is refused (403), not told it does not exist.
      const job = interview && (await jobResource(ctx, interview.jobId));
      if (!interview || !job) throw new InterviewError('interview_not_found');
      await authorize(ctx, 'interview.schedule', job);
      // shortcut: only an interview with no time yet is scheduled; moving a scheduled one waits for a reschedule ticket.
      if (interview.status !== 'to_schedule') throw new InterviewError('not_schedulable');
      if (input.scheduledAt <= now()) throw new InterviewError('time_in_past');
      if (!(await ports.canInterview(ctx, input.interviewerUserId, job)))
        throw new InterviewError('interviewer_not_on_job');
      const store = storeFor(ctx.tx);
      // SAFETY: a draft is its interviewer's unsubmitted word (holdsScorecard): a new interviewer never inherits it.
      if (
        input.interviewerUserId !== interview.interviewerUserId &&
        (await store.findDraft(ctx.workspaceId, interview.id))
      )
        throw new InterviewError('interviewer_has_draft');
      const others = (await store.list(ctx.workspaceId, ['scheduled', 'in_progress'], input.interviewerUserId)).filter(
        (other) => other.id !== interview.id,
      );
      const clashAt = clashingAt(input.scheduledAt, others);
      if (clashAt && !input.keepClash) return { status: 'clash', clashAt };
      if (
        !(await store.schedule(
          ctx.workspaceId,
          interview.id,
          interview.status,
          input.scheduledAt,
          input.interviewerUserId,
        ))
      )
        throw new InterviewError('status_move');
      // Nobody is contacted here: the event has no consumer, and the invitation is a separate, confirmed step.
      await ports.publishInterviewScheduled(ctx.tx, {
        ...interview,
        scheduledAt: input.scheduledAt,
        interviewerUserId: input.interviewerUserId,
        status: 'scheduled',
      });
      return { status: 'scheduled' };
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
      // Workspace-wide roles are checked here; job-scoped ones per job below (with no job they fail closed).
      if (!JOB_SCOPED_ROLES.includes(ctx.role)) await authorize(ctx, 'interview.view');
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

    /** The demo seed's reset (AIV-P2-001): admins; refuses unless the workspace is flagged synthetic. */
    async purgeSyntheticInterviews(ctx: WorkspaceContext): Promise<void> {
      await authorize(ctx, 'workspace.settings');
      if (!(await ports.isSyntheticWorkspace(ctx))) throw new InterviewError('not_synthetic');
      await storeFor(ctx.tx).deleteAll(ctx.workspaceId);
    },
  };
}
