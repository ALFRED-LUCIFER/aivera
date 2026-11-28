import { chosenOrDecided, type Stage } from '@credalent/intake';
import type { InterviewStatus } from '@credalent/interviews';
import { profileHref } from './profile.ts';

// AIV-P1-165 §11 and §12: what a recruiter does next from one candidate's profile. Pure. The rows are the job's
// ranking as its page lists it, so "Previous" and "Next" walk the same order.

/** The part of a ranking row the profile's actions read. */
export type RankedRow = {
  personId: string;
  stage: Stage;
  /** Null until the candidate is assessed. */
  score: object | null;
  inPack?: true;
  interview?: { id: string; status: InterviewStatus };
};

/**
 * The profile's one primary action: "Choose for interview", then "Add to decision pack" once chosen. None for a
 * member who may not take it, once the candidate is in a pack or decided on, or while a chosen candidate has no
 * assessment for a pack to hold.
 */
export function primaryAction(
  row: Pick<RankedRow, 'stage' | 'score' | 'inPack'> | undefined,
  may: { choose: boolean; pack: boolean },
): 'choose' | 'pack' | null {
  if (!row) return null;
  if (!chosenOrDecided(row.stage)) return may.choose ? 'choose' : null;
  return may.pack && row.stage === 'interview' && row.score && !row.inPack ? 'pack' : null;
}

/** The profiles before and after this candidate's in the ranking's order; null at either end, or when not listed. */
export function neighbours(rows: readonly Pick<RankedRow, 'personId'>[], candidateId: string, jobId: string) {
  const at = rows.findIndex((row) => row.personId === candidateId);
  const href = (row: Pick<RankedRow, 'personId'> | undefined) => (row ? profileHref(row.personId, jobId) : null);
  return { previous: at > 0 ? href(rows[at - 1]) : null, next: at >= 0 ? href(rows[at + 1]) : null };
}

/**
 * The candidate's open interview, as the profile offers it: "Start interview" before it has started, "Open scorecard"
 * once it has. Null with no open interview.
 */
export function interviewAction(row: Pick<RankedRow, 'interview'> | undefined) {
  const interview = row?.interview;
  if (!interview) return null;
  if (interview.status === 'to_schedule' || interview.status === 'scheduled')
    return { kind: 'start' as const, interviewId: interview.id };
  if (interview.status === 'in_progress' || interview.status === 'scorecard_due')
    return { kind: 'open' as const, interviewId: interview.id };
  return null;
}

/** What the profile's header offers, as the page hands it to the browser. */
export type ProfileActions = {
  /** The one primary button; null when the member has none to take. */
  primary: { kind: 'choose' | 'pack'; onOpen: () => void } | null;
  /** "Start interview" (a button: it marks the interview started) or "Open scorecard" (a link). */
  interview: { kind: 'start'; pending: boolean; onStart: () => void } | { kind: 'open'; href: string } | null;
  previous: string | null;
  next: string | null;
};
