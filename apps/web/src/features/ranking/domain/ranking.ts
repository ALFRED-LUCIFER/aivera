import type { RankingRow } from '@credalent/assessment';
import type { ApplicationListItem, Stage } from '@credalent/intake';

/** An assessed candidate's figures, with the missing critical competencies by name. */
export type CandidateScore = Omit<RankingRow, 'candidateId' | 'missingCritical'> & { missing: string[] };

/** A table row as the page hands it to the browser: plain data, keyed by the application id, no person id. */
export type CandidateRow = {
  id: string;
  name: string | null;
  stage: Stage;
  /** Null until the candidate is assessed: "Not yet scored", basis "Not yet available" (AGENTS.md 1.7). */
  score: CandidateScore | null;
};

/** The page's data: the job, whether its rubric is approved yet, and every applicant's row. */
export type RankingData = { jobId: string; awaitingRubric: boolean; rows: CandidateRow[] };

/**
 * Ranked rows in rank order, then everyone not yet assessed, newest first: ranking orders attention and nobody drops
 * out of the list (AGENTS.md 1.5). A ranking row with no application on this job has no name to show and is left out.
 */
export function toCandidateRows(
  applicants: ApplicationListItem[],
  ranking: RankingRow[],
  competencyName: (competencyId: string) => string | undefined,
): CandidateRow[] {
  const scores = new Map(ranking.map((r) => [r.candidateId, r]));
  const row = (a: ApplicationListItem): CandidateRow => {
    const r = scores.get(a.personId);
    if (!r) return { id: a.applicationId, name: a.displayName, stage: a.stage, score: null };
    const { candidateId: _, missingCritical, ...figures } = r;
    const missing = missingCritical.flatMap((id) => competencyName(id) ?? []);
    return { id: a.applicationId, name: a.displayName, stage: a.stage, score: { ...figures, missing } };
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
