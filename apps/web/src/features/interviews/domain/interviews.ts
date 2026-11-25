import type { InterviewStatus, Round } from '@credalent/interviews';

/** One row of the Interviews list (AIV-P2-002): names for people to read, joined on the server from opaque ids. */
export type InterviewRow = {
  id: string;
  /** Null: the person has no name yet. */
  candidate: string | null;
  job: string;
  round: Round;
  /** Their title in the workspace, else their name; null for the signed-in member, shown as "You". */
  interviewer: string | null;
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
};

/** The scorecard page of one interview (AIV-P2-004). */
export const scorecardHref = (interviewId: string) => `/app/interviews/${interviewId}`;

export type RowAction =
  | { kind: 'openScorecard'; href: string }
  | { kind: 'scorecardDue'; days: number }
  // shortcut: "Guide ready" needs the interview guide, which does not exist yet; AIV-P2-003 adds it and that state here.
  | { kind: 'noGuide' }
  | null;

/** What the Action column offers for a row; nothing while there is no time, or once it is completed. */
export function rowAction({ id, status, dueDays }: Pick<InterviewRow, 'id' | 'status' | 'dueDays'>): RowAction {
  if (status === 'in_progress') return { kind: 'openScorecard', href: scorecardHref(id) };
  if (status === 'scorecard_due') return { kind: 'scorecardDue', days: dueDays ?? 0 };
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
