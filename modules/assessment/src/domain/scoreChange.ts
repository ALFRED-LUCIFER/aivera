// An interview-based score change (AIV-P1-117): what an interviewer's rating of a competency does to the evidence
// links `assess` scores. Pure: there is no second formula here, only links in and links out.
// AGENTS.md 1.6: the interviewer's word is never "verified" and never a second, independent source.
import { STRENGTHS, type Provenance, type Strength } from '@credalent/evidence';
import { assess, type Assessment, type EvidenceLink, type Level, type RubricInput } from './assess.ts';

export const RATINGS = ['not_shown', 'partly_shown', 'clearly_shown', 'strongly_shown'] as const;
export type Rating = (typeof RATINGS)[number];

/** The scorecard's mapping (AIV-P2-005): Not shown, Claim only; Partly shown, no change; Clearly, Medium; Strongly, Strong. */
const TARGET: Record<Rating, 'claim' | 'medium' | 'strong' | null> = {
  not_shown: 'claim',
  partly_shown: null,
  clearly_shown: 'medium',
  strongly_shown: 'strong',
};

/**
 * How an interview-sourced link is scored: like submitted work, never corroborated. The candidate submitted nothing:
 * it is labelled the interviewer's word, not "Candidate-submitted".
 */
export const INTERVIEW_PROVENANCE = 'submitted' satisfies Provenance;

/**
 * One applied change, as stored. `claim` weakens the items named in `itemIds` (the competency's evidence when the
 * interview was held that no second source had checked; evidence added later is untouched). `medium` and `strong` add
 * one link citing the interview (`sourceId`) at `level`, the level the job needs.
 */
export type InterviewChange = {
  competencyId: string;
  /** The interview's opaque id: the source the change cites. */
  sourceId: string;
  strength: 'claim' | 'medium' | 'strong';
  level: number;
  itemIds: string[];
};

/**
 * The links `assess` scores once the interview changes (oldest first) are applied. The latest change per competency
 * and interview stands, so a later interview never removes what another interview showed.
 */
export function withInterviewChanges(
  links: readonly EvidenceLink[],
  changes: readonly InterviewChange[],
): EvidenceLink[] {
  let out = [...links];
  for (const change of new Map(changes.map((c) => [`${c.competencyId}:${c.sourceId}`, c])).values()) {
    if (change.strength === 'claim')
      out = out.map((l) =>
        l.competencyId === change.competencyId && change.itemIds.includes(l.itemId) ? { ...l, strength: 'claim' } : l,
      );
    else
      out.push({
        itemId: change.sourceId,
        competencyId: change.competencyId,
        level: change.level,
        strength: change.strength,
        provenance: INTERVIEW_PROVENANCE,
      });
  }
  return out;
}

/** The strongest strength among a competency's links that are not contradicted; null with no evidence (a gap). */
export function strengthOf(links: readonly EvidenceLink[], competencyId: string): Strength | null {
  const own = links.filter((l) => l.competencyId === competencyId && l.provenance !== 'contradictory');
  return STRENGTHS.find((s) => own.some((l) => l.strength === s)) ?? null;
}

export type CompetencyState = { strength: Strength | null; provenLevel: Level };

/** A competency a set of ratings would change, with the change to store for it. */
export type CompetencyChange = {
  competencyId: string;
  rating: Rating;
  from: CompetencyState;
  to: CompetencyState;
  change: InterviewChange;
};

const state = (assessment: Assessment, links: readonly EvidenceLink[], competencyId: string): CompetencyState => ({
  strength: strengthOf(links, competencyId),
  provenLevel: assessment.competencies.find((c) => c.competencyId === competencyId)?.proven.level ?? 0,
});

export type RatingInput = { competencyId: string; rating: Rating };

/**
 * What the ratings would do: the assessment before (the stored changes applied) and after (the ratings applied too),
 * and one entry per competency whose strength or proven level moves. A rating that moves nothing is left out.
 * Throws `RangeError` for a competency outside the rubric.
 */
export function previewRatings(
  rubric: RubricInput,
  links: readonly EvidenceLink[],
  stored: readonly InterviewChange[],
  ratings: readonly RatingInput[],
  sourceId: string,
): { before: Assessment; after: Assessment; changes: CompetencyChange[] } {
  const beforeLinks = withInterviewChanges(links, stored);
  const before = assess(rubric, beforeLinks);
  const proposed = ratings.flatMap(({ competencyId, rating }): (InterviewChange & { rating: Rating })[] => {
    const competency = before.competencies.find((c) => c.competencyId === competencyId);
    if (!competency) throw new RangeError('The competency is not in the rubric version of this assessment');
    const strength = TARGET[rating];
    if (strength === null) return [];
    return [
      {
        rating,
        competencyId,
        sourceId,
        strength,
        // The level the job needs, whatever the candidate claimed: an uninspected claim never sets a backed level (1.6).
        level: strength === 'claim' ? 0 : competency.levelNeeded,
        itemIds:
          strength === 'claim'
            ? // One interviewer's word never overrides work a second source checked.
              links
                .filter(
                  (l) =>
                    l.competencyId === competencyId &&
                    l.provenance !== 'contradictory' &&
                    l.provenance !== 'corroborated',
                )
                .map((l) => l.itemId)
            : [],
      },
    ];
  });
  // Applied one at a time, so a rating that moves nothing is never stored and cannot displace an earlier change.
  let current = { links: beforeLinks, assessment: before, stored: [...stored] };
  const changes: CompetencyChange[] = [];
  for (const { rating, ...change } of proposed) {
    const nextStored = [...current.stored, change];
    const nextLinks = withInterviewChanges(links, nextStored);
    const next = assess(rubric, nextLinks);
    const from = state(current.assessment, current.links, change.competencyId);
    const to = state(next, nextLinks, change.competencyId);
    if (from.strength === to.strength && from.provenLevel === to.provenLevel) continue;
    changes.push({ competencyId: change.competencyId, rating, from, to, change });
    current = { links: nextLinks, assessment: next, stored: nextStored };
  }
  return { before, after: current.assessment, changes };
}
