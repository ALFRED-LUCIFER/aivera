// The facts behind "The trade-offs" of a comparison (AIV-P1-047), from the compared candidates' stored snapshots and
// the evidence they cite. Pure. Every comparison between candidates is written here, never by the model (AGENTS.md
// 1.6): a line is the rest of a sentence that begins with the candidate's name, which the page writes.
import type { EvidenceItemView } from '@credalent/evidence';
import type { Assessment } from './assess.ts';
import { isChecked, listText, type ExplainSource } from './explain.ts';

/** How many candidates one comparison holds: bounds the page's reads and the model's prompt. */
export const MAX_COMPARED = 10;

// shortcut: at most 2 excerpts per candidate go to the model, the heaviest competencies' first, so ten candidates fit
// one prompt; raise it if a pilot comparison leaves out the work a recruiter expected to read about.
const MAX_ITEMS = 2;

export type TradeoffFacts = {
  /** One line per fact; empty only for an assessment with no competency. */
  lines: string[];
  /** The evidence items behind the proven levels, heaviest competency first. */
  items: ExplainSource[];
};

/**
 * Each compared candidate's facts, in the order given: where they alone have independently checked work, where else
 * they have it, where they are below the level the job needs, what still rests on a claim and, with none of those, that
 * they are at the job's level. `names` are the approved rubric's competency names by id; `evidence[i]` is candidate i's.
 */
export function tradeoffFacts(
  assessments: readonly Assessment[],
  names: ReadonlyMap<string, string>,
  evidence: readonly (readonly EvidenceItemView[])[],
): TradeoffFacts[] {
  const byId = evidence.map((items) => new Map(items.map((item) => [item.id, item])));
  const checkedIds = assessments.map(
    (a, i) => new Set(a.competencies.filter((c) => isChecked(c, byId[i] ?? new Map())).map((c) => c.competencyId)),
  );
  return assessments.map((assessment, i) => {
    const items = byId[i] ?? new Map<string, EvidenceItemView>();
    const heaviestFirst = assessment.competencies.toSorted((a, b) => b.weightPercent - a.weightPercent);
    const list = (of: (c: Assessment['competencies'][number]) => boolean) =>
      heaviestFirst.filter(of).map((c) => names.get(c.competencyId) ?? 'an unnamed competency');
    const alone = (id: string) => checkedIds.every((ids, other) => other === i || !ids.has(id));
    const mine = checkedIds[i] ?? new Set<string>();
    const facts: [string, string[]][] = [
      [
        'is the only one compared with independently checked work on',
        list((c) => mine.has(c.competencyId) && alone(c.competencyId)),
      ],
      ['has independently checked work on', list((c) => mine.has(c.competencyId) && !alone(c.competencyId))],
      ['is below the level the job needs on', list((c) => c.proven.level < c.levelNeeded)],
      ['still rests on claims for', list((c) => c.claimedLevel > c.proven.level)],
    ];
    const lines = facts.filter(([, found]) => found.length > 0).map(([says, found]) => `${says} ${listText(found)}.`);
    if (lines.length === 0 && heaviestFirst.length > 0)
      lines.push('is at or above the level the job needs on every competency.');
    const seen = new Set<string>();
    return {
      lines,
      items: heaviestFirst
        .flatMap((c) => c.proven.itemIds)
        .flatMap((id): ExplainSource[] => {
          const item = items.get(id);
          if (!item || seen.has(id)) return [];
          seen.add(id);
          return [{ id, label: item.source.label, kind: item.source.kind, text: item.excerpt }];
        })
        .slice(0, MAX_ITEMS),
    };
  });
}
