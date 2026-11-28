// An interview tests specific evidence: one candidate's application on one job, one round, one interviewer, and the
// competencies of the job's approved rubric it must investigate (AIV-P2-001).

/** Labels: `interviews.round.*` in packages/i18n (Round 1, Round 2, Round 3: plain words, AIV-P1-165 §12). */
export const ROUNDS = ['structured_screen', 'evidence_defence', 'panel'] as const;
export type Round = (typeof ROUNDS)[number];

/**
 * `to_schedule` is an interview with no time yet (owner decision, 24 Nov 2026: the pilot does not schedule).
 * `scorecard_due` is computed from `scheduled` once its time passes (`effectiveStatus`), never written by a timer.
 */
export const STATUSES = ['to_schedule', 'scheduled', 'in_progress', 'scorecard_due', 'completed', 'cancelled'] as const;
export type InterviewStatus = (typeof STATUSES)[number];

const MOVES: Record<InterviewStatus, readonly InterviewStatus[]> = {
  // An unscheduled interview can still be held: the pilot records results without scheduling (#121 adds times), so its
  // scorecard can be submitted straight from it (AIV-P2-006).
  to_schedule: ['scheduled', 'in_progress', 'completed', 'cancelled'],
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

/** How long an interview is taken to hold its interviewer, for the clash warning (AIV-P2-007). */
const INTERVIEW_MINUTES = 60;

/**
 * The time of another interview of the same interviewer that overlaps one starting at `at` (each held for
 * `INTERVIEW_MINUTES`), or null. `others` are that interviewer's other scheduled or running interviews.
 */
export function clashingAt(at: Date, others: Pick<Interview, 'scheduledAt'>[]): Date | null {
  const hold = INTERVIEW_MINUTES * 60_000;
  return (
    others.find(({ scheduledAt }) => scheduledAt && Math.abs(scheduledAt.getTime() - at.getTime()) < hold)
      ?.scheduledAt ?? null
  );
}

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
  // Scheduling (AIV-P2-007).
  time_in_past: 'Choose a future time',
  not_schedulable: 'This interview already has a time, or has started or ended.',
  interviewer_has_draft:
    'The current interviewer has a scorecard draft. Keep them as interviewer, or ask them to clear it.',
  scorecard_closed: 'This interview is cancelled, so its scorecard cannot change.',
  competency_not_in_interview: 'This competency is not one the interview tests.',
  // The scorecard submit (AIV-P2-006).
  scorecard_submitted: 'Already submitted',
  scorecard_incomplete:
    'Rate at least one competency or mark its questions as not tested, and write what you saw or heard for each rating but Not shown.',
  not_synthetic: 'Only a synthetic demo workspace can be purged.',
  // The meeting summary (AIV-P1-115).
  summary_empty: 'Paste the meeting summary first.',
  summary_too_long: 'Shorten the summary to 12,000 characters or fewer.',
  summary_not_found: 'Meeting summary not found',
  summary_pending: 'Apply or decline the changes proposed from the earlier summary first.',
  summary_decided: 'These proposed changes are not waiting for a decision.',
  proposal_not_found: 'This summary proposes no change for that competency.',
  interview_not_held: 'This interview has not been held.',
  not_assessed: 'The candidate has no assessment to change yet.',
  preview_changed: 'The assessment changed since this preview. Preview the change again.',
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
