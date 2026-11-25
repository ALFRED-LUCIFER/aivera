import type { SuggestedQuestions } from '@credalent/assessment';
import type { EvidenceItemView } from '@credalent/evidence';
import { z } from 'zod';
import { citation } from './evidenceCards.ts';

// "Needs live verification" (AIV-P1-113): the suggested interview questions as the page hands them to the browser.
// Pure. The browser takes only this file's types; its value imports stay on the server.

/** What the browser may send to ask for questions: opaque ids only, checked again on the server (AGENTS.md 3.7). */
export const questionsInput = z.object({ candidateId: z.uuid(), jobId: z.uuid() });

export type QuestionCitationView = {
  key: string;
  quote: string;
  /** How the source is cited ("CV, page 1"); null for the competency's own line of the job's rubric. */
  label: string | null;
  /** Only inspected work is highlighted; a claim's words are quoted plain (AGENTS.md 1.6). */
  highlighted: boolean;
};

export type QuestionView = {
  text: string;
  strongAnswer: string;
  weakAnswer: string;
  citations: QuestionCitationView[];
};

export type QuestionsView =
  | { status: 'no_gaps' }
  | { status: 'not_suggested' }
  | {
      status: 'suggested';
      /** The evidence has changed the snapshot since these were suggested. */
      stale: boolean;
      gaps: { competencyId: string; name: string; questions: QuestionView[] }[];
    };

/** What asking gives: the new view, or why there is none (`waiting`: today's AI allowance is spent). */
export type SuggestOutcome = QuestionsView | { status: 'waiting' } | { status: 'failed' };

/**
 * The stored questions with each gap's competency name and each citation's source label. `names` are the approved
 * rubric's competency names by id; a gap it does not name is left out, as is a citation of an item no longer listed.
 */
export function questionsView(
  result: SuggestedQuestions,
  names: ReadonlyMap<string, string>,
  evidence: readonly EvidenceItemView[],
): QuestionsView {
  if (result.status !== 'suggested') return { status: result.status };
  const items = new Map(evidence.map((item) => [item.id, item]));
  return {
    status: 'suggested',
    stale: result.stale,
    gaps: result.gaps.flatMap(({ competencyId, questions }) => {
      const name = names.get(competencyId);
      if (name === undefined) return [];
      return [
        {
          competencyId,
          name,
          questions: questions.map(({ citations, ...question }) => ({
            ...question,
            citations: citations.flatMap(({ itemId, quote }, i): QuestionCitationView[] => {
              if (itemId === null) return [{ key: `rubric:${i}`, quote, label: null, highlighted: false }];
              const item = items.get(itemId);
              if (!item) return [];
              // SAFETY: the highlighter marks inspected work only; a claim's words stay plain, whatever strength the
              // claim is stored with (AGENTS.md 1.6), as on the evidence cards above.
              const highlighted =
                item.strength !== 'claim' && (item.provenance === 'corroborated' || item.provenance === 'submitted');
              return [{ key: `${itemId}:${i}`, quote, label: citation(item.source, item.excerptSpan), highlighted }];
            }),
          })),
        },
      ];
    }),
  };
}
