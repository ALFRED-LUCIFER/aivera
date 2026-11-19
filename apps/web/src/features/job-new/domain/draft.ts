import { JOB_TYPE_CATALOGUE, type DraftedCompetency } from '@aivera/jobs';
import type { NewJobState } from './jobNew.ts';

// Add a job, step 2 "Competencies, drafted and suggested" (AIV-P1-008). Pure: no React, no I/O (ADR-003).

/** Where a drafted competency came from in the description: the sentence (or list line) and the quoted span in it. */
export type Excerpt = { text: string; start: number; end: number };

export type DraftCompetency = Pick<
  DraftedCompetency,
  'name' | 'evidenceExpected' | 'weightPercent' | 'levelNeeded' | 'type'
> & {
  /** Empty for a competency the recruiter added or took from the job type's starters. */
  excerpts: Excerpt[];
};
export type DraftRow = DraftCompetency & { id: string };

/** What "Draft competencies" answers. Nothing is saved in any of them. */
export type DraftResult =
  | { status: 'idle' }
  | { status: 'invalid'; errors: NewJobState['errors'] }
  /** No description to draft from. */
  | { status: 'empty' }
  /** `leftOutNonSkill`: a line asking for something that is not a skill (a nationality, an age) was left out. */
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

/** A drafted competency as the step shows it: its cited spans become excerpts of the description. */
export const toDraftCompetency = (description: string, c: DraftedCompetency): DraftCompetency => ({
  name: c.name,
  evidenceExpected: c.evidenceExpected,
  weightPercent: c.weightPercent,
  levelNeeded: c.levelNeeded,
  type: c.type,
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
    excerpts: [],
  }));

export const blankCompetency = (): DraftCompetency => ({
  name: '',
  evidenceExpected: '',
  weightPercent: 10,
  levelNeeded: 3,
  type: 'mandatory',
  excerpts: [],
});
