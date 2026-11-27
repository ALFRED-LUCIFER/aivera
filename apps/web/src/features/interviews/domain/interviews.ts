import type { InterviewStatus, Round } from '@credalent/interviews';
import type { InterviewerOption } from './schedule.ts';

/** One row of the Interviews list (AIV-P2-002): names for people to read, joined on the server from opaque ids. */
export type InterviewRow = {
  id: string;
  /** Null: the person has no name yet. */
  candidate: string | null;
  job: string;
  round: Round;
  /** Their title in the workspace, else their name; null for the signed-in member, shown as "You". */
  interviewer: string | null;
  /** The interviewer's opaque user id, which the Schedule dialog starts from (AIV-P2-007). */
  interviewerUserId: string;
  /** ISO time; null while the interview has no time. */
  scheduledAt: string | null;
  /** On the viewer's calendar day: "Today, 14:00". */
  today: boolean;
  status: InterviewStatus;
  /** Whole calendar days since the interview, while its scorecard is due. */
  dueDays: number | null;
  competencies: string[];
};

export const VIEWS = ['ongoing', 'completed'] as const;
export type InterviewView = (typeof VIEWS)[number];
export const parseView = (value: unknown): InterviewView => (value === 'completed' ? 'completed' : 'ongoing');

export type InterviewsData = Record<InterviewView, InterviewRow[]> & {
  /** How many people and jobs the completed interviews cover, for the summary line. */
  people: number;
  jobs: number;
  /** Who may be chosen as interviewer, for admins and recruiters; null for members who cannot schedule (AIV-P2-007). */
  interviewers: InterviewerOption[] | null;
};

/** The scorecard page of one interview (AIV-P2-004). */
export const scorecardHref = (interviewId: string) => `/app/interviews/${interviewId}`;

export type RowAction =
  | { kind: 'openScorecard'; href: string }
  /** No time yet: admins and recruiters schedule it (AIV-P2-007). */
  | { kind: 'schedule' }
  | { kind: 'scorecardDue'; days: number; href: string }
  // shortcut: "Guide ready" needs the interview guide, which does not exist yet; AIV-P2-003 adds it and that state here.
  | { kind: 'noGuide' }
  | null;

/** What the Action column offers for a row: Schedule while there is no time (for those who may), nothing once completed. */
export function rowAction(
  { id, status, dueDays }: Pick<InterviewRow, 'id' | 'status' | 'dueDays'>,
  canSchedule = false,
): RowAction {
  if (status === 'to_schedule') return canSchedule ? { kind: 'schedule' } : null;
  if (status === 'in_progress') return { kind: 'openScorecard', href: scorecardHref(id) };
  // A scheduled interview whose time has passed reads as due, so this is how its scorecard is reached.
  if (status === 'scorecard_due') return { kind: 'scorecardDue', days: dueDays ?? 0, href: scorecardHref(id) };
  if (status === 'scheduled') return { kind: 'noGuide' };
  return null;
}

// The Interviews artboard's order: what is under way, then what is coming, then scorecards overdue, then no time yet.
const ORDER: InterviewStatus[] = ['in_progress', 'scheduled', 'scorecard_due', 'to_schedule'];

/** Ongoing rows in the artboard's order. Within a status they keep the order they came in: soonest first. */
export const inListOrder = (rows: InterviewRow[]) =>
  rows.toSorted((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status));

/** Whether two instants fall on the same calendar day in `timeZone`. */
export function sameDay(a: Date, b: Date, timeZone: string) {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone, dateStyle: 'short' });
  return day.format(a) === day.format(b);
}
