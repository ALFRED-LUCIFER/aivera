// The only public surface of @credalent/interviews (ADR-002).
import type { EventDefinition } from '@credalent/db/outbox';
import type { WorkspaceContext } from '@credalent/workspaces';
import { z } from 'zod';
import type { CreateInterviewInput, InterviewFilter, Scorecard } from '../application/interviews.ts';
import type { ApplySummaryInput, MeetingSummaryView, SummaryPreview } from '../application/summary.ts';
import type { Interview } from '../domain/interview.ts';
import type { ScorecardDraft } from '../domain/scorecard.ts';

export { InterviewError, scorecardDueDays } from '../domain/interview.ts';
export type { Interview, InterviewErrorCode, InterviewStatus, Round } from '../domain/interview.ts';
export type { ApplySummaryInput, MeetingSummaryView, ProposalView, SummaryPreview } from '../application/summary.ts';
export { FINDINGS, SUMMARY_MAX_CHARS, summaryTextSchema } from '../domain/summary.ts';
export type { Finding, ProposalStatus, ProposedStrength, SummaryStatus } from '../domain/summary.ts';
export type { CreateInterviewInput, InterviewFilter, Scorecard } from '../application/interviews.ts';
export {
  assessedRatings,
  MARKS,
  notAssessed,
  RATINGS,
  RECOMMENDATIONS,
  scorecardDraftSchema,
  toInterviewNoteEvidence,
  unrated,
} from '../domain/scorecard.ts';
export type {
  DraftCompetency,
  InterviewNoteEvidence,
  Mark,
  Rating,
  Recommendation,
  ScorecardDraft,
} from '../domain/scorecard.ts';

const interviewEvent = z.strictObject({ interviewId: z.uuid(), applicationId: z.uuid() });

/**
 * Written to `interviews.outbox` in the transaction that gives an interview a time. Strict and opaque ids only, so a
 * name or a time in the payload is refused (AGENTS.md 1.2, 3.1).
 */
export const InterviewScheduledV1 = {
  type: 'InterviewScheduled.v1',
  payload: interviewEvent,
} satisfies EventDefinition<z.infer<typeof interviewEvent>>;

/** Written by the scorecard submit that completes an interview (AIV-P2-006), the same shape as `InterviewScheduled.v1`. */
export const InterviewCompletedV1 = {
  type: 'InterviewCompleted.v1',
  payload: interviewEvent,
} satisfies EventDefinition<z.infer<typeof interviewEvent>>;

const summaryEvent = z.strictObject({ summaryId: z.uuid(), interviewId: z.uuid() });

/**
 * Written to `interviews.outbox` in the transaction that stores a pasted meeting summary (AIV-P1-115); the worker's
 * job `interviews.summary.analyse` then proposes evidence changes from it. Strict and opaque ids only: the summary's
 * text stays in `interviews.meeting_summaries` (AGENTS.md 1.2, 3.1).
 */
export const MeetingSummarySubmittedV1 = {
  type: 'MeetingSummarySubmitted.v1',
  payload: summaryEvent,
} satisfies EventDefinition<z.infer<typeof summaryEvent>>;

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
   * An interview (as `getInterview`, null when the context cannot see it) with its scorecard draft (AIV-P2-004). The
   * draft is returned only to the interview's interviewer and to admins; `canEdit` is theirs while the interview is not
   * completed or cancelled. Reads nothing of the assessment.
   */
  getScorecard(ctx: WorkspaceContext, interviewId: string): Promise<Scorecard | null>;
  /**
   * Stores the interview's scorecard draft, replacing the earlier one. It changes no score, stage or status: the
   * assessment changes only when the scorecard is submitted (AIV-P2-006). Only the interview's interviewer, on a job
   * they can reach, or a workspace admin: `ForbiddenError`, storing nothing, for anyone else, an interviewer or hiring
   * owner with no grant on the job included. Throws `InterviewError` `interview_not_found`, `scorecard_closed` (completed or
   * cancelled), `competency_not_in_interview` (a competency the interview does not test, or one listed twice); a zod
   * error for a draft that is not `scorecardDraftSchema`.
   */
  saveScorecardDraft(ctx: WorkspaceContext, interviewId: string, draft: ScorecardDraft): Promise<void>;
  /**
   * Stores a pasted meeting summary on the interview (plain text, 1 to 12,000 characters) and writes
   * `MeetingSummarySubmitted.v1`, so the worker proposes evidence changes from it. It changes no score, evidence or
   * stage and is not audited: nothing has been decided (AGENTS.md 1.5). Only the people on the interview: its
   * interviewer, or an admin or recruiter, each on a job they can reach (`scorecard.submit`); `ForbiddenError`, storing
   * nothing, for another interviewer or a hiring owner who is not its interviewer. Throws `InterviewError`
   * `summary_empty`, `summary_too_long`, `interview_not_found` (another workspace's too), `interview_not_held` (still
   * scheduled, or cancelled) and `summary_pending` (an earlier summary is being analysed or waits for a decision).
   */
  submitMeetingSummary(ctx: WorkspaceContext, interviewId: string, text: string): Promise<{ summaryId: string }>;
  /**
   * The interview's newest meeting summary for the people who may act on it (as `submitMeetingSummary`; null for
   * anyone else): its status, "Unusual content in this summary", and one proposal per competency the interview tests
   * (finding, the quoted excerpt, the reason, the proposed strength: Claim only, Medium, or none). While `proposed`,
   * each proposal that changes something carries the competency's strength and proven level before and after, from the
   * assessment's own preview, and `alreadyChanged` when the interview's scorecard already changed that competency
   * (excluded by default); `preview` is the backed score before and after for the proposals included by default.
   * `previewUnavailable` when the assessment cannot be previewed now. Never the summary's text. Writes nothing.
   */
  getMeetingSummary(ctx: WorkspaceContext, interviewId: string): Promise<{ summary: MeetingSummaryView | null } | null>;
  /**
   * The backed score before and after for the proposals of `competencyIds`, and the `previewId` to apply them with.
   * Writes nothing. Who and refusals as `applySummaryProposals`.
   */
  previewSummaryProposals(
    ctx: WorkspaceContext,
    summaryId: string,
    competencyIds: readonly string[],
  ): Promise<SummaryPreview>;
  /**
   * Applies the proposals a person confirmed, each with their reason, in the caller's transaction: the summary and
   * its proposals are marked (the others declined), the summary is recorded as an `interview_note` evidence source
   * ("Interviewer's summary, 24 Nov") with one item per change citing its excerpt, never Strong and never
   * corroborated, and the assessment's score change stores one new snapshot and audits each change (`score.changed`:
   * actor, time, competency, strength and backed score before and after, the reason) as the last statements. Who as
   * `submitMeetingSummary`. Throws `InterviewError` `summary_not_found`, `summary_decided` (not waiting for a
   * decision), `proposal_not_found` (a competency the summary proposes no change for), `not_assessed`,
   * `competency_not_in_rubric` (the job's rubric changed since the interview) and `preview_changed` (the assessment is
   * not the one previewed: "Preview the change again"); anything thrown stores nothing.
   */
  applySummaryProposals(ctx: WorkspaceContext, summaryId: string, input: ApplySummaryInput): Promise<void>;
  /**
   * Declines every proposal: no score, evidence or audit entry is written, and the summary stays on the interview.
   * Who as `submitMeetingSummary`. Throws `summary_not_found`, `summary_decided`.
   */
  declineSummaryProposals(ctx: WorkspaceContext, summaryId: string): Promise<void>;
  /**
   * The demo seed's reset (`pnpm db:seed --reset`): deletes the workspace's interviews. Admins. Throws
   * `InterviewError('not_synthetic')`, deleting nothing, unless the workspace is flagged synthetic. The flag is the only
   * check: interviews carry no synthetic mark of their own, so it deletes every one in a flagged workspace.
   */
  purgeSyntheticInterviews(ctx: WorkspaceContext): Promise<void>;
}
