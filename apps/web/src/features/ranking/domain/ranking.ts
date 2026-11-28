import type { RankingRow } from '@credalent/assessment';
import type { Interview, InterviewStatus, Round } from '@credalent/interviews';
import type { ApplicationListItem, Stage } from '@credalent/intake';
import { IN_PROGRESS, type CvView } from '@/features/evidence-profile/domain/cvStatus.ts';
import type { RowDuplicates } from './duplicates.ts';
import type { BulkActionId } from './selection.ts';

/**
 * An assessed candidate's figures, with the missing critical competencies and the competencies a Round 1 interview
 * should investigate (AIV-P1-114) by name.
 */
export type CandidateScore = Omit<RankingRow, 'candidateId' | 'missingCritical' | 'gaps' | 'cited'> & {
  missing: string[];
  investigate: string[];
  /**
   * The row's one-line reason (AIV-P1-165 §9): the competency that adds most to the backed score and the cited item
   * behind it, or with nothing proven the largest claim, marked `claim` (it counts zero, AGENTS.md 1.6). Absent when
   * the result cites nothing or the rubric does not name the competency.
   */
  reason?: { competency: string; itemId: string; level: number; claim: boolean };
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
  /** The application's current interview round (AIV-P2-007): the stage reads "Round 1 on 20 Nov", "Round 1 complete". */
  interview?: RowInterview;
  /** Not yet scored: where the CV is, so the row says why (AIV-P1-165 §7). */
  cv?: CvView;
  /**
   * The uploaded CV's file name, while no name is read from it (admins and recruiters): shown on screen in place of
   * "Unnamed applicant" and nowhere else, never in a log, URL or browser storage (AGENTS.md 1.2).
   */
  fileName?: string;
};

/** The name a row shows: the person's, else the CV's file name until a name is read, else `unnamed`. */
export const rowName = (row: Pick<CandidateRow, 'name' | 'fileName'>, unnamed: string) =>
  row.fileName ?? row.name ?? unnamed;

/** Rows whose CV is being read or assessed: "Assessing N CVs", and the page refreshes itself meanwhile. */
export const inProgress = (rows: CandidateRow[]) =>
  rows.filter((row) => !row.score && row.cv && IN_PROGRESS.includes(row.cv.state)).length;

/** An application's current interview, as a row shows it: plain data, the time as ISO. */
export type RowInterview = {
  id: string;
  round: Round;
  status: Exclude<InterviewStatus, 'cancelled'>;
  scheduledAt: string | null;
  /** Its time falls on the viewer's calendar day, decided on the server: "Round 1 today, 14:00". */
  today: boolean;
};

const OPEN: readonly InterviewStatus[] = ['to_schedule', 'scheduled', 'in_progress', 'scorecard_due'];

const standing = (i: Interview) => (OPEN.includes(i.status) ? 2 : i.status === 'completed' ? 1 : 0);

/**
 * Each application's current interview: an open one (the latest round when several), else the last one held. A
 * cancelled interview is never shown. `interviews` are those the interviews contract returned for the member; `today`
 * says whether a time falls on the viewer's day.
 */
export function currentInterviews(interviews: Interview[], today: (at: Date) => boolean): Map<string, RowInterview> {
  const current = new Map<string, Interview>();
  for (const i of interviews) {
    if (standing(i) === 0) continue;
    const held = current.get(i.applicationId);
    if (!held || standing(i) > standing(held) || (standing(i) === standing(held) && i.createdAt > held.createdAt))
      current.set(i.applicationId, i);
  }
  return new Map(
    [...current].flatMap(([applicationId, i]) =>
      i.status === 'cancelled'
        ? []
        : [
            [
              applicationId,
              {
                id: i.id,
                round: i.round,
                status: i.status,
                scheduledAt: i.scheduledAt?.toISOString() ?? null,
                today: !!i.scheduledAt && today(i.scheduledAt),
              },
            ] as const,
          ],
    ),
  );
}

/** The row with its application's current interview, when it has one (rows are keyed by application id). */
export const withInterview = <T extends { id: string }>(row: T, interviews: Map<string, RowInterview>) => {
  const interview = interviews.get(row.id);
  return interview ? { ...row, interview } : row;
};

/** Which round line a row shows ("Round 1 today, 14:00" when it falls on the viewer's day). */
export function roundLabelKey({ status, scheduledAt, today }: Pick<RowInterview, 'status' | 'scheduledAt' | 'today'>) {
  if (status === 'scheduled' && scheduledAt) return today ? 'today' : 'scheduled';
  return status === 'scheduled' ? 'to_schedule' : status;
}

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
    const { candidateId: _, missingCritical, gaps, cited, ...figures } = r;
    const competency = cited && competencyName(cited.competencyId);
    // SAFETY: `claim` passes through as the snapshot has it, so a claim's line is always labelled a claim.
    const reason = cited && competency && { competency, itemId: cited.itemId, level: cited.level, claim: cited.claim };
    return {
      ...base,
      score: { ...figures, missing: names(missingCritical), investigate: names(gaps), ...(reason && { reason }) },
    };
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
      (!q || rowName(row, '').toLocaleLowerCase().includes(q)) &&
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
/** Hidden until asked for: the ranking opens on name, backed score, meets need and next action (AIV-P1-165 §9). */
export const HIDDEN_BY_DEFAULT: readonly HideableColumn[] = ['confidence', 'missing', 'lastScored'];

/** "Compare top 3": the three highest-ranked candidates' person ids, or null until three are scored. */
export const TOP_COMPARED = 3;
export const topRanked = (rows: readonly CandidateRow[]): string[] | null => {
  const top = rows.filter((row) => row.score).slice(0, TOP_COMPARED);
  return top.length === TOP_COMPARED ? top.map((row) => row.personId) : null;
};
