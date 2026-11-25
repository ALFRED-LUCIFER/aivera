import type { CompetencyResult } from '@credalent/assessment';
import { describe, expect, it } from 'vitest';
import { needRows, needSummary, radarShape, type NeedRow } from './needs.ts';

// AIV-P1-044. Sara as the Candidate artboard draws her: [name, weight, proven, claimed, needed].
const SARA: [string, number, number, number, number][] = [
  ['LLM systems in production', 25, 5, 5, 4],
  ['Retrieval and evaluation', 20, 5, 5, 4],
  ['Python service engineering', 15, 3, 4, 3],
  ['Product judgement', 15, 3, 4, 3],
  ['Cost and reliability', 15, 1, 4, 2],
  ['Arabic and bilingual NLP', 10, 0, 4, 2],
];
const result = ([name, weightPercent, proven, claimedLevel, levelNeeded]: (typeof SARA)[number]): CompetencyResult => ({
  competencyId: name,
  weightPercent,
  levelNeeded,
  mandatory: true,
  proven: { level: proven, itemIds: [] } as CompetencyResult['proven'],
  claimedLevel: claimedLevel as CompetencyResult['claimedLevel'],
  claimItemIds: [],
});
const names = new Map(SARA.map(([name]) => [name, name]));
const row = (proven: number, claimed: number, needed: number): NeedRow => ({
  competencyId: 'c',
  name: 'Cost and reliability',
  proven,
  claimed,
  needed,
});

describe('needRows', () => {
  it('gives one row per named competency, heaviest first, with the proven, claimed and needed levels', () => {
    const rows = needRows(SARA.toReversed().map(result), names);
    // Equal weights keep the order they arrive in, as the evidence cards do.
    expect(rows.map((r) => [r.name, r.proven, r.claimed, r.needed])).toEqual([
      ['LLM systems in production', 5, 5, 4],
      ['Retrieval and evaluation', 5, 5, 4],
      ['Cost and reliability', 1, 4, 2],
      ['Product judgement', 3, 4, 3],
      ['Python service engineering', 3, 4, 3],
      ['Arabic and bilingual NLP', 0, 4, 2],
    ]);
  });

  it('gives no row to a competency the approved rubric does not name', () => {
    expect(needRows(SARA.map(result), new Map([['Product judgement', 'Product judgement']]))).toHaveLength(1);
  });
});

describe('needSummary', () => {
  it('Scenario: Summary count: Sara meets the need on 4 of 6, and both gaps would close if the claims hold', () => {
    expect(needSummary(needRows(SARA.map(result), names))).toEqual({ meets: 4, gaps: 2, closing: 2 });
  });

  // SAFETY: mutation check: `r.proven < r.needed` -> `r.claimed < r.needed` -> this test failed (a claim met the need)
  it('never counts a claim as meeting the need', () => {
    expect(needSummary([row(1, 5, 2)])).toEqual({ meets: 0, gaps: 1, closing: 1 });
  });

  it('Scenario: A gap with no claim does not close', () => {
    expect(needSummary([row(1, 1, 3), row(1, 2, 3), row(0, 4, 2)])).toEqual({ meets: 0, gaps: 3, closing: 1 });
  });
});

describe('radarShape', () => {
  it("draws the artboard's proven shape for Sara's six levels", () => {
    expect(radarShape([5, 5, 3, 3, 1, 0])).toBe('270,60 365.3,115 327.2,203 270,236 250.9,181 270,170');
  });
});
