// The only public surface of @credalent/interviews (ADR-002).
import type { EventDefinition } from '@credalent/db/outbox';
import type { WorkspaceContext } from '@credalent/workspaces';
import { z } from 'zod';
import type { CreateInterviewInput, InterviewFilter } from '../application/interviews.ts';
import type { Interview } from '../domain/interview.ts';

export { InterviewError, scorecardDueDays } from '../domain/interview.ts';
export type { Interview, InterviewStatus, Round } from '../domain/interview.ts';
export type { CreateInterviewInput, InterviewFilter } from '../application/interviews.ts';

const interviewEvent = z.strictObject({ interviewId: z.uuid(), applicationId: z.uuid() });

/**
 * Written to `interviews.outbox` in the transaction that gives an interview a time. Strict and opaque ids only, so a
 * name or a time in the payload is refused (AGENTS.md 1.2, 3.1).
 */
export const InterviewScheduledV1 = {
  type: 'InterviewScheduled.v1',
  payload: interviewEvent,
} satisfies EventDefinition<z.infer<typeof interviewEvent>>;

/** Written by the scorecard submit that completes an interview (AIV-P2-004), the same shape as `InterviewScheduled.v1`. */
export const InterviewCompletedV1 = {
  type: 'InterviewCompleted.v1',
  payload: interviewEvent,
} satisfies EventDefinition<z.infer<typeof interviewEvent>>;

/** Every call takes the request context from `WorkspacesContract.withWorkspace` and runs in its scoped transaction. */
export interface InterviewsContract {
  /**
   * An interview of one application on the job it belongs to, for a round, with an interviewer and the competencies to
   * investigate. With `scheduledAt` it is `scheduled` and writes `InterviewScheduled.v1`; without, it is `to_schedule`
   * ("Not scheduled yet"). Admins and recruiters on the job (`interview.schedule`). Throws, writing nothing:
   * `InterviewError` `application_not_found` (unknown, or its job hidden from the context), `rubric_not_approved`,
   * `competency_not_in_rubric` (a competency not in the approved version), `interviewer_not_on_job` (not an active
   * member who can see the job); `ForbiddenError` for any other role; a zod error for a malformed input.
   */
  createInterview(ctx: WorkspaceContext, input: CreateInterviewInput): Promise<{ interviewId: string }>;
  /**
   * Moves an interview to `in_progress` from `to_schedule`, `scheduled` or `scorecard_due` (`status_move` otherwise).
   * Admins and recruiters on the job; hiring owners and interviewers only on the interviews they hold
   * (`ForbiddenError`). An interview the context cannot see is `interview_not_found`.
   */
  startInterview(ctx: WorkspaceContext, interviewId: string): Promise<void>;
  /**
   * Ongoing (`to_schedule`, `scheduled`, `in_progress`, `scorecard_due`) or completed interviews, soonest first and those
   * with no time last, each with the status to show now. Only jobs the context can see; an interviewer sees their own.
   */
  listInterviews(ctx: WorkspaceContext, filter: InterviewFilter): Promise<Interview[]>;
  /** One interview with the status to show now, or null when the context cannot see it (as in `listInterviews`). */
  getInterview(ctx: WorkspaceContext, interviewId: string): Promise<Interview | null>;
  /**
   * The demo seed's reset (`pnpm db:seed --reset`): deletes the workspace's interviews. Admins. Throws
   * `InterviewError('not_synthetic')`, deleting nothing, unless the workspace is flagged synthetic. The flag is the only
   * check: interviews carry no synthetic mark of their own, so it deletes every one in a flagged workspace.
   */
  purgeSyntheticInterviews(ctx: WorkspaceContext): Promise<void>;
}
