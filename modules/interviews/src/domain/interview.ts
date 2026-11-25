// An interview tests specific evidence: one candidate's application on one job, one round, one interviewer, and the
// competencies of the job's approved rubric it must investigate (AIV-P2-001).

/** Labels: `interviews.round.*` in packages/i18n (Round 1, structured screen; Round 2, evidence defence; Round 3, panel). */
export const ROUNDS = ['structured_screen', 'evidence_defence', 'panel'] as const;
export type Round = (typeof ROUNDS)[number];

/**
 * `to_schedule` is an interview with no time yet (owner decision, 24 Nov 2026: the pilot does not schedule).
 * `scorecard_due` is computed from `scheduled` once its time passes (`effectiveStatus`), never written by a timer.
 */
export const STATUSES = ['to_schedule', 'scheduled', 'in_progress', 'scorecard_due', 'completed', 'cancelled'] as const;
export type InterviewStatus = (typeof STATUSES)[number];

const MOVES: Record<InterviewStatus, readonly InterviewStatus[]> = {
  // An unscheduled interview can still be held: the pilot records results without scheduling (#121 adds times).
  to_schedule: ['scheduled', 'in_progress', 'cancelled'],
  scheduled: ['in_progress', 'scorecard_due', 'cancelled'],
  scorecard_due: ['in_progress', 'completed', 'cancelled'],
  in_progress: ['completed'],
  completed: [],
  cancelled: [],
};

export const canMove = (from: InterviewStatus, to: InterviewStatus) => MOVES[from].includes(to);

/** Listed under "Ongoing"; `completed` is listed under "Completed"; `cancelled` under neither. */
export const ONGOING: readonly InterviewStatus[] = ['to_schedule', 'scheduled', 'in_progress', 'scorecard_due'];

export type Interview = {
  id: string;
  workspaceId: string;
  applicationId: string;
  jobId: string;
  candidateId: string;
  round: Round;
  interviewerUserId: string;
  /** Null while `to_schedule`. */
  scheduledAt: Date | null;
  status: InterviewStatus;
  /** The approved rubric version the competencies come from. */
  rubricVersionId: string;
  competencyIds: string[];
  createdBy: string;
  createdAt: Date;
};

/**
 * The status to show at `now`: a scheduled interview whose time has passed with nobody starting it has its scorecard
 * due. One a person started stays in progress until its scorecard is submitted (AIV-P2-006).
 */
export const effectiveStatus = (
  { status, scheduledAt }: Pick<Interview, 'status' | 'scheduledAt'>,
  now: Date,
): InterviewStatus => (status === 'scheduled' && scheduledAt && scheduledAt <= now ? 'scorecard_due' : status);

const calendarDay = (at: Date, timeZone: string) =>
  Date.parse(
    new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at),
  );

/** Whole calendar days in the viewer's time zone from the interview's day to today: "Scorecard due, 2 days". */
export const scorecardDueDays = (scheduledAt: Date, now: Date, timeZone: string) =>
  Math.max(0, Math.round((calendarDay(now, timeZone) - calendarDay(scheduledAt, timeZone)) / 86_400_000));

const MESSAGES = {
  application_not_found: 'Application not found',
  interview_not_found: 'Interview not found',
  rubric_not_approved: "Approve the job's rubric before planning interviews.",
  competency_not_in_rubric: "This competency is not in the job's approved rubric",
  interviewer_not_on_job: 'The interviewer must be an active member who can see this job.',
  status_move: 'This interview cannot move to that status.',
  scorecard_closed: 'This interview is completed or cancelled, so its scorecard cannot change.',
  competency_not_in_interview: 'This competency is not one the interview tests.',
  not_synthetic: 'Only a synthetic demo workspace can be purged.',
} as const;

export type InterviewErrorCode = keyof typeof MESSAGES;

/** A refused interview operation. The message never repeats the refused value (AGENTS.md 1.2). */
export class InterviewError extends Error {
  readonly code: InterviewErrorCode;
  constructor(code: InterviewErrorCode) {
    super(MESSAGES[code]);
    this.name = 'InterviewError';
    this.code = code;
  }
}
