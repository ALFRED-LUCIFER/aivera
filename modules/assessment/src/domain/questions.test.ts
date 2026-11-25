import { describe, expect, it } from 'vitest';
import type { CompetencyResult } from './assess.ts';
import { competencySourceId, selectGaps, storedGaps, type Gap } from './questions.ts';

// AIV-P1-113: which competencies need live verification. Synthetic data only.
const competency = (
  competencyId: string,
  weightPercent: number,
  proven: number,
  claimedLevel: number,
  more: Partial<CompetencyResult> = {},
): CompetencyResult =>
  ({
    competencyId,
    weightPercent,
    levelNeeded: 3,
    mandatory: true,
    proven: proven === 0 ? { level: 0, itemIds: [] } : { level: proven, itemIds: [`${competencyId}-work`] },
    claimedLevel,
    claimItemIds: claimedLevel > proven ? [`${competencyId}-claim`] : [],
    ...more,
  }) as CompetencyResult;

const ids = (competencies: CompetencyResult[]) => selectGaps({ competencies }).map((g) => g.competencyId);

describe('selectGaps', () => {
  it('a competency proven below the level the job needs is a gap; one that meets it with no open claim is not', () => {
    expect(ids([competency('below', 50, 2, 2), competency('met', 50, 3, 3)])).toEqual(['below']);
  });

  // SAFETY: mutation check: removed `|| c.claimedLevel > c.proven.level` from selectGaps -> this test failed (no gap)
  it('a competency that meets the need but rests on a claim above what inspected work shows is a gap', () => {
    expect(ids([competency('claimed', 100, 3, 5)])).toEqual(['claimed']);
  });

  it('a claim at or below the proven level adds nothing to test: no gap', () => {
    expect(ids([competency('checked', 100, 5, 5, { claimItemIds: ['cv-line'] })])).toEqual([]);
  });

  it('a competency with no evidence item at all is a gap with no items', () => {
    expect(selectGaps({ competencies: [competency('none', 100, 0, 0)] })).toEqual([
      { competencyId: 'none', weightPercent: 100, levelNeeded: 3, provenLevel: 0, claimedLevel: 0, itemIds: [] },
    ]);
  });

  it('lists the heaviest first, the rubric order between equal weights, and at most 4', () => {
    const competencies = [
      competency('light', 5, 0, 0),
      competency('first-of-equal', 20, 0, 0),
      competency('heavy', 30, 0, 0),
      competency('second-of-equal', 20, 0, 0),
      competency('mid', 25, 0, 0),
    ];
    expect(ids(competencies)).toEqual(['heavy', 'mid', 'first-of-equal', 'second-of-equal']);
  });

  it("a gap's items are its claims first, then the work behind the proven level", () => {
    expect(selectGaps({ competencies: [competency('c', 100, 2, 4)] })[0]?.itemIds).toEqual(['c-claim', 'c-work']);
  });
});

const gap = (competencyId: string, itemIds: string[]): Gap => ({
  competencyId,
  weightPercent: 50,
  levelNeeded: 3,
  provenLevel: 0,
  claimedLevel: 4,
  itemIds,
});
const question = (sourceId: string) => ({
  text: 'How was it measured?',
  strongAnswer: 'Names the set.',
  weakAnswer: 'Stays general.',
  citations: [{ sourceId, quote: 'raised answer accuracy' }],
});

describe('storedGaps', () => {
  const labels = new Map([
    ['C1', gap('c-retrieval', ['e1'])],
    ['C2', gap('c-arabic', [])],
  ]);
  it('stores each gap by its competency id and each citation by its item, or the rubric line with no item', () => {
    const stored = storedGaps(
      [
        { competencyId: 'C1', questions: [question('e1')] },
        { competencyId: 'C2', questions: [question(competencySourceId('c-arabic'))] },
      ],
      labels,
    );
    expect(stored.map((g) => [g.competencyId, g.questions[0]?.citations])).toEqual([
      ['c-retrieval', [{ itemId: 'e1', quote: 'raised answer accuracy' }]],
      ['c-arabic', [{ itemId: null, quote: 'raised answer accuracy' }]],
    ]);
  });

  // SAFETY: mutation check: kept a citation of any source in storedGaps -> this test failed (the question was stored)
  it("drops a question that cites only another gap's source, and a gap left with none (AGENTS.md 1.6)", () => {
    expect(storedGaps([{ competencyId: 'C2', questions: [question('e1')] }], labels)).toEqual([]);
  });

  it('keeps the first answer for a gap answered twice', () => {
    const twice = [
      { competencyId: 'C1', questions: [question('e1')] },
      { competencyId: 'C1', questions: [question('e1'), question('e1')] },
    ];
    expect(storedGaps(twice, labels).map((g) => g.questions.length)).toEqual([1]);
  });
});
