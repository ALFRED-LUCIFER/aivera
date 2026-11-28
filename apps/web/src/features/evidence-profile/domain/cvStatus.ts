import type { CvStatusView } from '@credalent/evidence';
import { z } from 'zod';

/**
 * Where a candidate's CV is on its way to a score (AIV-P1-165 §7), as the ranking row and the profile say it. Every
 * state has its own words and icon, so a CV is never left as "Not yet scored" with no reason.
 */
export type CvState =
  'reading' | 'waiting' | 'unreadable' | 'failed' | 'assessing' | 'couldNotAssess' | 'noCv' | 'afterApproval';

/** What "Try again" re-runs: the CV's read (AIV-P1-134) or the candidate's assessment for the job. Opaque ids only. */
export const retrySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('cv'), sourceId: z.uuid() }),
  z.strictObject({ kind: z.literal('mapping'), candidateId: z.uuid(), jobId: z.uuid() }),
]);
export type RetryTarget = z.infer<typeof retrySchema>;
export type RetryResult = { ok: true } | { ok: false; error: 'invalid' | 'refused' | 'failed' };

/** What a CV's "Try again" shows: whether a retry is running, and a refusal or failure to say beside it. */
export type CvRetryView = {
  pending: boolean;
  /** The last retry's refusal or failure, for that CV only. */
  problemFor(target: RetryTarget): 'refused' | 'failed' | null;
  onRetry(target: RetryTarget): void;
};

/** One key per CV and job a retry is for, so a problem shows beside its own row only. */
export const retryKey = (target: RetryTarget) =>
  target.kind === 'cv' ? target.sourceId : `${target.candidateId}:${target.jobId}`;

/** A not-yet-scored candidate's CV: its state and, for an admin or recruiter, what "Try again" re-runs. */
export type CvView = { state: CvState; retry: RetryTarget | null };

/** States that end without anyone acting: the page refreshes itself while any CV is in one. */
export const IN_PROGRESS: readonly CvState[] = ['reading', 'assessing'];

/** How often the ranking and a profile refresh while a CV is read or assessed. */
export const LIVE_REFRESH_MS = 5000;
/** How long a page keeps refreshing itself on its own; a reload starts it again (review finding X6). */
export const LIVE_REFRESH_LIMIT_MS = 15 * 60_000;

/**
 * The state of a candidate not yet scored on the job's approved rubric. A failed mapping wins: the CV was read, so
 * its parse status no longer explains anything. `mayRetry` is the server's answer (admins and recruiters).
 */
export function cvView(
  { candidateId, cv, mappingFailed }: CvStatusView,
  job: { jobId: string; rubricApproved: boolean },
  mayRetry: boolean,
): CvView {
  const state: CvState = mappingFailed
    ? 'couldNotAssess'
    : !cv
      ? 'noCv'
      : cv.status === 'pending'
        ? 'reading'
        : cv.status === 'parsed'
          ? job.rubricApproved
            ? 'assessing'
            : 'afterApproval'
          : cv.status;
  const retry: RetryTarget | null = !mayRetry
    ? null
    : state === 'failed' && cv
      ? { kind: 'cv', sourceId: cv.sourceId }
      : state === 'couldNotAssess'
        ? { kind: 'mapping', candidateId, jobId: job.jobId }
        : null;
  return { state, retry };
}
