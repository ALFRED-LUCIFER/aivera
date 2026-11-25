import type { CandidateRow } from './ranking.ts';

// AIV-P1-036: selecting candidates on the ranking and the bulk actions on them.

/**
 * The bulk actions, each with the feature flag that hides it until its target exists (as navigation.ts does for
 * screens, AIV-P1-095): the action's ticket sets its flag to null. Compare opens the comparison page (AIV-P1-047, #111);
 * Choose for interview moves people to Round 1 (AIV-P1-114); Add to decision pack (AIV-P2-010). Request evidence
 * (AIV-P1-038, #102) and Message join this list with their tickets.
 */
export const BULK_ACTIONS = [
  { id: 'compare', flag: 'compare' },
  { id: 'chooseForInterview', flag: null },
  { id: 'addToPack', flag: null },
] as const satisfies readonly {
  id: string;
  flag: string | null;
}[];
export type BulkActionId = (typeof BULK_ACTIONS)[number]['id'];

/**
 * The bulk actions a member may use: admins and recruiters only, never an interviewer or a hiring owner (AGENTS.md
 * 1.3). The server decides this; with none, the page offers no selection.
 */
export const bulkActionsFor = (role: string, flags: ReadonlySet<string>): BulkActionId[] =>
  role === 'admin' || role === 'recruiter'
    ? BULK_ACTIONS.filter(({ flag }) => flag === null || flags.has(flag)).map(({ id }) => id)
    : [];

/** The URL's `selected` value: comma-separated application ids. Only ids of this job's rows are kept, in rank order. */
export const parseSelected = (param: string | null, rows: CandidateRow[]): string[] => {
  const asked = new Set((param ?? '').split(','));
  return rows.filter((row) => asked.has(row.id)).map((row) => row.id);
};

/** Compare takes two or three candidates. */
export type CompareState = 'ready' | 'tooFew' | 'tooMany';
export const compareState = (selected: number): CompareState =>
  selected < 2 ? 'tooFew' : selected > 3 ? 'tooMany' : 'ready';

/** The comparison's address: the job and the candidates' opaque person ids, as the profile is addressed. */
export const compareHref = (jobId: string, personIds: string[]) =>
  `/app/jobs/${jobId}/compare?ids=${personIds.join(',')}`;
