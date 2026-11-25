import type { RankingRow } from '@credalent/assessment';
import type { ApplicationListItem, Stage } from '@credalent/intake';
import type { RowDuplicates } from './duplicates.ts';
import type { BulkActionId } from './selection.ts';

/**
 * An assessed candidate's figures, with the missing critical competencies and the competencies a Round 1 interview
 * should investigate (AIV-P1-114) by name.
 */
export type CandidateScore = Omit<RankingRow, 'candidateId' | 'missingCritical' | 'gaps'> & {
  missing: string[];
  investigate: string[];
};

/**
 * A table row as the page hands it to the browser: plain data, keyed by the application id. The opaque person id is
 * the candidate profile's address (AIV-P1-043); `duplicates`, for the merge actions (AIV-P1-018), reaches only admins
 * and recruiters.
 */
export type CandidateRow = {
  id: string;
  personId: string;
  name: string | null;
  stage: Stage;
  /** Null until the candidate is assessed: "Not yet scored", basis "Not yet available" (AGENTS.md 1.7). */
  score: CandidateScore | null;
  duplicates?: RowDuplicates;
  /** In an undecided decision pack of this job (AIV-P2-010): the next action reads "In shortlist pack". */
  inPack?: true;
};

/** An undecided decision pack of the job, for "Add to decision pack" (AIV-P2-010); its members by person id. */
export type PackChoice = { id: string; name: string; candidateIds: string[] };

/**
 * The page's data: the job, whether its rubric is approved yet, every applicant's row, and the bulk actions this
 * member may use on selected rows (AIV-P1-036): none means no selection is offered.
 */
export type RankingData = {
  jobId: string;
  awaitingRubric: boolean;
  rows: CandidateRow[];
  bulkActions: BulkActionId[];
  /** The job's undecided packs, for members who may add to one (AIV-P2-010). */
  packs?: PackChoice[];
};

/**
 * Ranked rows in rank order, then everyone not yet assessed, newest first: ranking orders attention and nobody drops
 * out of the list (AGENTS.md 1.5). A ranking row with no application on this job has no name to show and is left out.
 */
export function toCandidateRows(
  applicants: ApplicationListItem[],
  ranking: RankingRow[],
  competencyName: (competencyId: string) => string | undefined,
  duplicates: ReadonlyMap<string, RowDuplicates> = new Map(),
): CandidateRow[] {
  const scores = new Map(ranking.map((r) => [r.candidateId, r]));
  // An id the rubric does not name is left out, never shown raw.
  const names = (ids: string[]) => ids.flatMap((id) => competencyName(id) ?? []);
  const row = (a: ApplicationListItem): CandidateRow => {
    const dup = duplicates.get(a.personId);
    const base = {
      id: a.applicationId,
      personId: a.personId,
      name: a.displayName,
      stage: a.stage,
      ...(dup && { duplicates: dup }),
    };
    const r = scores.get(a.personId);
    if (!r) return { ...base, score: null };
    const { candidateId: _, missingCritical, gaps, ...figures } = r;
    return { ...base, score: { ...figures, missing: names(missingCritical), investigate: names(gaps) } };
  };
  const rows = applicants.map(row);
  const rank = (r: CandidateRow) => r.score?.rank ?? Number.MAX_SAFE_INTEGER;
  // toSorted is stable, so the unscored keep intake's newest-first order.
  return rows.toSorted((a, b) => rank(a) - rank(b));
}

/** The first rows shown before "Show all N" (Candidates artboard). */
export const FIRST_ROWS = 7;

export type RankingFilters = {
  query: string;
  /** '' is every stage ("Stage: all"). */
  stage: Stage | '';
  /** A competency name; '' is any ("Missing evidence: any"). */
  missing: string;
};

export const NO_FILTERS: RankingFilters = { query: '', stage: '', missing: '' };

export function filterRows(rows: CandidateRow[], { query, stage, missing }: RankingFilters) {
  const q = query.trim().toLocaleLowerCase();
  return rows.filter(
    (row) =>
      (!q || (row.name ?? '').toLocaleLowerCase().includes(q)) &&
      (!stage || row.stage === stage) &&
      (!missing || (row.score?.missing.includes(missing) ?? false)),
  );
}

/** The filters' choices: the stages and missing competencies the rows have, in first-seen (rank) order. */
export const stageOptions = (rows: CandidateRow[]) => [...new Set(rows.map((row) => row.stage))];
export const missingOptions = (rows: CandidateRow[]) => [...new Set(rows.flatMap((row) => row.score?.missing ?? []))];

/** Columns the Columns menu can hide; "#" and "Candidate" always show. */
export const HIDEABLE_COLUMNS = ['score', 'meetsNeed', 'confidence', 'missing', 'lastScored', 'nextAction'] as const;
export type HideableColumn = (typeof HIDEABLE_COLUMNS)[number];
