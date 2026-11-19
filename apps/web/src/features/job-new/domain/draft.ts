import {
  COMPETENCY_ORIGINS,
  COMPETENCY_TYPES,
  JOB_TYPE_CATALOGUE,
  type Competency,
  type DraftedCompetency,
  type SuggestedCompetency,
} from '@aivera/jobs';
import { z } from 'zod';
import type { NewJobState } from './jobNew.ts';

// Add a job, steps 2 and 3 "Competencies, drafted and suggested" and "Save to the job as its rubric" (AIV-P1-008 to
// AIV-P1-010). Pure: no React, no I/O (ADR-003).

/** Where a drafted competency came from in the description: the sentence (or list line) and the quoted span in it. */
export type Excerpt = { text: string; start: number; end: number };

export type DraftCompetency = Pick<
  DraftedCompetency,
  'name' | 'evidenceExpected' | 'weightPercent' | 'levelNeeded' | 'type'
> & {
  /** Drafted from the description, suggested by Aivera, or added by the recruiter (by hand or from the starters). */
  origin: Competency['origin'];
  /** A suggestion's "Why:" sentence; null for any other competency. */
  why: string | null;
  /** Empty for a competency the recruiter added or took from the job type's starters. */
  excerpts: Excerpt[];
};
/** `removed`: taken out of the rubric, kept on the page so it can be restored with its weight. */
export type DraftRow = DraftCompetency & { id: string; removed: boolean };

/** What "Draft competencies" answers. Nothing is saved in any of them. */
export type DraftResult =
  | { status: 'idle' }
  | { status: 'invalid'; errors: NewJobState['errors'] }
  /** No description to draft from. */
  | { status: 'empty' }
  /**
   * The drafted competencies, then the suggestions. `leftOutNonSkill`: a line asking for something that is not a skill
   * (a nationality, an age) was left out.
   */
  | { status: 'drafted'; competencies: DraftCompetency[]; leftOutNonSkill: boolean }
  /** The model failed, or its answer was rejected twice by the citation contract. */
  | { status: 'failed' }
  /** The workspace has used its daily AI budget. */
  | { status: 'budget' };

const sentences = new Intl.Segmenter('en', { granularity: 'sentence' });

/** The sentence or list line of `text` holding [start, end), with the span's offsets within it. */
export function excerptOf(text: string, start: number, end: number): Excerpt {
  const segments = [...sentences.segment(text)];
  const first = segments.findLast((s) => s.index <= start) ?? { index: 0, segment: '' };
  const last = segments.findLast((s) => s.index < end) ?? first;
  const from = first.index;
  return { text: text.slice(from, last.index + last.segment.length).trimEnd(), start: start - from, end: end - from };
}

/** A drafted or suggested competency as the step shows it: its cited spans become excerpts of the description. */
export const toDraftCompetency = (
  description: string,
  c: DraftedCompetency | SuggestedCompetency,
): DraftCompetency => ({
  name: c.name,
  evidenceExpected: c.evidenceExpected,
  weightPercent: c.weightPercent,
  levelNeeded: c.levelNeeded,
  type: c.type,
  origin: c.origin,
  why: c.origin === 'suggested_by_aivera' ? c.why : null,
  excerpts: c.citations.map((citation) => excerptOf(description, citation.start, citation.end)),
});

/** The fallback when there is no draft: the job type's four starter competencies, equal weights, for the recruiter to edit. */
export const starterCompetencies = (jobType: string): DraftCompetency[] =>
  (JOB_TYPE_CATALOGUE.find((e) => e.key === jobType)?.starterCompetencies ?? []).map((name) => ({
    name,
    evidenceExpected: '',
    weightPercent: 25,
    levelNeeded: 3,
    type: 'mandatory',
    origin: 'added_by_recruiter',
    why: null,
    excerpts: [],
  }));

export const blankCompetency = (): DraftCompetency => ({
  name: '',
  evidenceExpected: '',
  weightPercent: 10,
  levelNeeded: 3,
  type: 'mandatory',
  origin: 'added_by_recruiter',
  why: null,
  excerpts: [],
});

/** What the weights of the competencies still in the rubric add up to; anything but 100 rebalances on save. */
export const weightsTotal = (rows: readonly DraftRow[]) =>
  rows.reduce((sum, row) => (row.removed ? sum : sum + row.weightPercent), 0);

/** At most this many competencies in a rubric: 8 drafted, 2 suggested, room for the recruiter's own. */
export const RUBRIC_MAX = 20;

const competency = z.object({
  name: z.string().trim().min(1).max(120),
  evidenceExpected: z.string().trim().max(400),
  weightPercent: z.number().int().min(1).max(100),
  levelNeeded: z.number().int().min(1).max(5),
  type: z.enum(COMPETENCY_TYPES),
  origin: z.enum(COMPETENCY_ORIGINS),
});

/** The posted `rubric` field: the kept competencies in display order (AGENTS.md 3.7). Null when it is not valid. */
export function parseRubric(value: FormDataEntryValue | null): Competency[] | null {
  try {
    const parsed = z
      .array(competency)
      .min(1)
      .max(RUBRIC_MAX)
      .safeParse(JSON.parse(String(value)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The kept competencies as the `rubric` field posts them: no ids, excerpts, why or removed rows. */
export const rubricJson = (rows: readonly DraftRow[]) =>
  JSON.stringify(
    rows
      .filter((row) => !row.removed)
      .map(({ name, evidenceExpected, weightPercent, levelNeeded, type, origin }) => ({
        name,
        evidenceExpected,
        weightPercent,
        levelNeeded,
        type,
        origin,
      })),
  );

export type RowErrors = Record<string, { name?: true; weight?: true }>;

/** The kept rows' fields to fix before saving: a name, and a weight that is a whole percent from 1 to 100. */
export function rowErrors(rows: readonly DraftRow[]): RowErrors {
  const errors: RowErrors = {};
  for (const row of rows) {
    if (row.removed) continue;
    const weight = Number.isInteger(row.weightPercent) && row.weightPercent >= 1 && row.weightPercent <= 100;
    if (!row.name.trim() || !weight)
      errors[row.id] = { ...(!row.name.trim() && { name: true }), ...(!weight && { weight: true }) };
  }
  return errors;
}
