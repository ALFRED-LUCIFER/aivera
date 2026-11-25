// An interview-based score change (AIV-P1-117): what an interviewer's rating of a competency does to the evidence
// links `assess` scores. Pure: there is no second formula here, only links in and links out.
// AGENTS.md 1.6: the interviewer's word is never "verified" and never a second, independent source.
import { STRENGTHS, type Provenance, type Strength } from '@credalent/evidence';
import { assess, counts, type Assessment, type EvidenceLink, type Level, type RubricInput } from './assess.ts';

export const RATINGS = ['not_shown', 'partly_shown', 'clearly_shown', 'strongly_shown'] as const;
export type Rating = (typeof RATINGS)[number];

/**
 * Not shown, Claim only; Partly shown, no change; Clearly and Strongly shown, Medium. The scorecard (AIV-P2-005) draws
 * Strongly shown as Strong, but Strong means checked by a second source, and one interviewer's word is not one: it is
 * capped at Medium, as a meeting summary is (AIV-P1-115). The rating itself is stored, so the two are still told apart.
 */
const TARGET: Record<Rating, 'claim' | 'medium' | null> = {
  not_shown: 'claim',
  partly_shown: null,
  clearly_shown: 'medium',
  strongly_shown: 'medium',
};

/**
 * How an interview-sourced link is scored: like submitted work, never corroborated. The candidate submitted nothing:
 * it is labelled the interviewer's word, not "Candidate-submitted".
 */
export const INTERVIEW_PROVENANCE = 'submitted' satisfies Provenance;

/**
 * One applied rating, as stored. Not shown weakens the items named in `itemIds` (the competency's evidence when the
 * interview was held that no second source had checked; evidence added later is untouched). Clearly and Strongly shown
 * add one link citing the interview (`sourceId`) at `level`, the level the job needs. Partly shown adds nothing: it is
 * stored only to take back the same interview's earlier rating.
 */
export type InterviewChange = {
  competencyId: string;
  /** The interview's opaque id: the source the change cites. */
  sourceId: string;
  rating: Rating;
  level: number;
  itemIds: string[];
};

/**
 * The links `assess` scores once the interview changes (oldest first) are applied. The latest rating per competency
 * and interview stands, so a later interview never removes what another interview showed.
 */
export function withInterviewChanges(
  links: readonly EvidenceLink[],
  changes: readonly InterviewChange[],
): EvidenceLink[] {
  let out = [...links];
  for (const change of new Map(changes.map((c) => [`${c.competencyId}:${c.sourceId}`, c])).values()) {
    const strength = TARGET[change.rating];
    if (strength === 'claim')
      out = out.map((l) =>
        l.competencyId === change.competencyId && change.itemIds.includes(l.itemId) ? { ...l, strength } : l,
      );
    else if (strength)
      out.push({
        itemId: change.sourceId,
        competencyId: change.competencyId,
        level: change.level,
        strength,
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

/** Why a rating moves neither strength nor proven level now; it is stored all the same, for when the evidence changes. */
export type NoChange = 'outranked_by_checked_work' | 'outranked_by_other_interview' | 'no_effect';

/** A rated competency: its state before and after, why nothing moved if nothing did, and the change to store. */
export type CompetencyChange = {
  competencyId: string;
  rating: Rating;
  from: CompetencyState;
  to: CompetencyState;
  noChange: NoChange | null;
  /** The same interview's earlier rating of the competency, which this one replaces; null when it gave none. */
  replaces: Rating | null;
  change: InterviewChange;
};

const state = (assessment: Assessment, links: readonly EvidenceLink[], competencyId: string): CompetencyState => ({
  strength: strengthOf(links, competencyId),
  provenLevel: assessment.competencies.find((c) => c.competencyId === competencyId)?.proven.level ?? 0,
});

export type RatingInput = { competencyId: string; rating: Rating };

/**
 * What the ratings would do: the assessment before (the stored changes applied) and after (the ratings applied too),
 * and one entry per rating. A rating that moves nothing now is still listed, with why, so it is stored and holds when
 * the evidence changes later; only a Partly shown that changes nothing is left out. Throws `RangeError` for a
 * competency outside the rubric.
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
  const otherInterviews = new Set(stored.map((c) => c.sourceId).filter((s) => s !== sourceId));
  let current = { links: beforeLinks, assessment: before, stored: [...stored] };
  const changes: CompetencyChange[] = [];
  for (const { competencyId, rating } of ratings) {
    const competency = before.competencies.find((c) => c.competencyId === competencyId);
    if (!competency) throw new RangeError('The competency is not in the rubric version of this assessment');
    const change: InterviewChange = {
      competencyId,
      sourceId,
      rating,
      // The level the job needs, whatever the candidate claimed: an uninspected claim never sets a backed level (1.6).
      level: TARGET[rating] === 'medium' ? competency.levelNeeded : 0,
      itemIds:
        rating === 'not_shown'
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
    };
    const nextStored = [...current.stored, change];
    const nextLinks = withInterviewChanges(links, nextStored);
    const next = assess(rubric, nextLinks);
    const from = state(current.assessment, current.links, competencyId);
    const to = state(next, nextLinks, competencyId);
    const moved = from.strength !== to.strength || from.provenLevel !== to.provenLevel;
    const replaces = stored.findLast((c) => c.competencyId === competencyId && c.sourceId === sourceId)?.rating ?? null;
    // "No change" is stored only to take back this interview's earlier rating of the competency.
    if (rating === 'partly_shown' && !replaces) continue;
    const counted = nextLinks.filter((l) => l.competencyId === competencyId && l.itemId !== sourceId && counts(l));
    const noChange = moved
      ? null
      : counted.some((l) => l.provenance === 'corroborated')
        ? 'outranked_by_checked_work'
        : counted.some((l) => otherInterviews.has(l.itemId))
          ? 'outranked_by_other_interview'
          : 'no_effect';
    changes.push({ competencyId, rating, from, to, noChange, replaces, change });
    current = { links: nextLinks, assessment: next, stored: nextStored };
  }
  return { before, after: current.assessment, changes };
}
