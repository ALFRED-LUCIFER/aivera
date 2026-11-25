// Which competencies need live verification, and the suggested interview questions stored for them (AIV-P1-113).
// Pure. The questions are guidance for a person: nothing here reads or changes a score (AGENTS.md 1.5).
import type { Assessment } from './assess.ts';

// shortcut: at most 4 gaps and 4 evidence items a gap go to the model, to bound one call; raise them if a pilot
// rubric leaves a heavy gap or the item a question should test out.
export const MAX_GAPS = 4;
const MAX_ITEMS = 4;

/** A competency whose evidence a person should test live, with the snapshot's items for it, claims first. */
export type Gap = {
  competencyId: string;
  weightPercent: number;
  levelNeeded: number;
  provenLevel: number;
  claimedLevel: number;
  itemIds: string[];
};

/**
 * The snapshot's gaps, heaviest first (the rubric's order between equal weights), at most `MAX_GAPS`: a competency
 * proven below the level the job needs (one with no evidence at all too), or resting on a claim: its claimed level is
 * above what inspected work shows. A claim at or below the proven level adds nothing to test, so it makes no gap.
 */
export function selectGaps(snapshot: Pick<Assessment, 'competencies'>): Gap[] {
  return snapshot.competencies
    .filter((c) => c.proven.level < c.levelNeeded || c.claimedLevel > c.proven.level)
    .toSorted((a, b) => b.weightPercent - a.weightPercent)
    .slice(0, MAX_GAPS)
    .map((c) => ({
      competencyId: c.competencyId,
      weightPercent: c.weightPercent,
      levelNeeded: c.levelNeeded,
      provenLevel: c.proven.level,
      claimedLevel: c.claimedLevel,
      itemIds: [...c.claimItemIds, ...c.proven.itemIds].slice(0, MAX_ITEMS),
    }));
}

/** The id of the source that stands for a competency with no evidence item, so its questions still cite something. */
export const competencySourceId = (competencyId: string) => `competency:${competencyId}`;

/** What a question rests on: an evidence item's exact words, or (`itemId` null) the competency's own rubric line. */
export type QuestionCitation = { itemId: string | null; quote: string };
export type SuggestedQuestion = {
  text: string;
  strongAnswer: string;
  weakAnswer: string;
  citations: QuestionCitation[];
};
export type SuggestedGap = { competencyId: string; questions: SuggestedQuestion[] };

/**
 * The model's checked answer as stored: each gap by its competency id, each citation by its evidence item. A citation
 * of a source that is not the gap's own is dropped, then a question left citing nothing, then a gap left with no
 * question (AGENTS.md 1.6). `labels` maps the prompt's gap labels ("C1") back to the gaps.
 */
export function storedGaps(
  answer: readonly {
    competencyId: string;
    questions: readonly {
      text: string;
      strongAnswer: string;
      weakAnswer: string;
      citations: readonly { sourceId: string; quote: string }[];
    }[];
  }[],
  labels: ReadonlyMap<string, Gap>,
): SuggestedGap[] {
  const seen = new Set<string>();
  return answer.flatMap(({ competencyId: label, questions }) => {
    const gap = labels.get(label);
    // A gap answered twice keeps its first answer, so no gap ever holds more than three questions.
    if (!gap || seen.has(label)) return [];
    seen.add(label);
    const own = competencySourceId(gap.competencyId);
    const kept = questions.flatMap(({ text, strongAnswer, weakAnswer, citations }) => {
      const cites = citations.flatMap(({ sourceId, quote }): QuestionCitation[] =>
        sourceId === own
          ? [{ itemId: null, quote }]
          : gap.itemIds.includes(sourceId)
            ? [{ itemId: sourceId, quote }]
            : [],
      );
      return cites.length > 0 ? [{ text, strongAnswer, weakAnswer, citations: cites }] : [];
    });
    return kept.length > 0 ? [{ competencyId: gap.competencyId, questions: kept }] : [];
  });
}
