import { PROVENANCES, STRENGTHS, type Provenance, type Strength } from '@credalent/evidence';
import { describe, expect, it } from 'vitest';
import { assess, confidenceFor, counts, type EvidenceLink, type RubricInput } from './assess.ts';

// The Senior AI Engineer rubric version 2 (tools/seed/src/cast.ts SAE_V2): weights 25/20/15/15/10/15.
const LLM = 'c-llm';
const RETRIEVAL = 'c-retrieval';
const PYTHON = 'c-python';
const COST = 'c-cost';
const ARABIC = 'c-arabic';
const PRODUCT = 'c-product';
const SAE_V2: RubricInput = {
  versionId: 'rubric-v2',
  competencies: [
    { id: LLM, weightPercent: 25, levelNeeded: 4, type: 'mandatory' },
    { id: RETRIEVAL, weightPercent: 20, levelNeeded: 4, type: 'mandatory' },
    { id: PYTHON, weightPercent: 15, levelNeeded: 3, type: 'mandatory' },
    { id: COST, weightPercent: 15, levelNeeded: 2, type: 'desirable' },
    { id: ARABIC, weightPercent: 10, levelNeeded: 2, type: 'desirable' },
    { id: PRODUCT, weightPercent: 15, levelNeeded: 3, type: 'mandatory' },
  ],
};

const link = (
  itemId: string,
  competencyId: string,
  level: number,
  strength: Strength,
  provenance: Provenance,
): EvidenceLink => ({ itemId, competencyId, level, strength, provenance });

// Sara Al Qahtani's synthetic evidence (cast.ts EVIDENCE), with the level each item shows.
const SARA = [
  link('sara-merchant', LLM, 5, 'strong', 'corroborated'),
  link('sara-harness', RETRIEVAL, 5, 'strong', 'corroborated'),
  link('sara-serve', PYTHON, 3, 'medium', 'submitted'),
  link('sara-reference', PRODUCT, 3, 'medium', 'corroborated'),
  link('sara-cost-claim', COST, 4, 'supporting', 'claim'),
  link('sara-arabic-claim', ARABIC, 4, 'claim', 'awaiting-defence'),
];
// Arjun Menon's: no item for Arabic NLP.
const ARJUN = [
  link('arjun-kyc', LLM, 4, 'strong', 'submitted'),
  link('arjun-notebook', RETRIEVAL, 3, 'medium', 'submitted'),
  link('arjun-queue', PYTHON, 5, 'strong', 'corroborated'),
  link('arjun-oncall-claim', COST, 3, 'supporting', 'claim'),
  link('arjun-decision', PRODUCT, 3, 'medium', 'submitted'),
];

const of = (result: ReturnType<typeof assess>, id: string) => result.competencies.find((c) => c.competencyId === id);

describe("Scenario: Sara's assessment on rubric version 2", () => {
  // Owner decision 20 Nov 2026: the formula wins over the artboard's 68 up to 84 (AIV-P1-030 PR).
  const sara = assess(SAE_V2, SARA);

  it('backed 63, up to 83 if her two open claims hold', () => {
    expect(sara.backedScore).toBe(63);
    expect(sara.upperBound).toBe(83);
  });

  it('meets the need on 4 of 6, and Arabic NLP is proven 0 of 5 with the job needing 2', () => {
    expect([sara.meetsNeed, sara.competencyCount]).toEqual([4, 6]);
    expect(of(sara, ARABIC)).toMatchObject({ proven: { level: 0, itemIds: [] }, levelNeeded: 2, claimedLevel: 4 });
  });

  it('a CV claim is proven 0, never 1 (AGENTS.md 1.6)', () => {
    expect(of(sara, COST)).toMatchObject({ proven: { level: 0 }, claimedLevel: 4, claimItemIds: ['sara-cost-claim'] });
  });

  it('confidence is Medium: 45% of the weight rests on Strong work', () => {
    // 25 + 20 of 100 proven by Strong items.
    expect(sara.confidence).toBe('Medium');
  });
});

describe('Scenario: Claims count zero in the backed score', () => {
  it('a candidate with only CV claims scores 0 backed and more than 0 up to', () => {
    const claimsOnly = SAE_V2.competencies.map((c, i) => link(`claim-${i}`, c.id, 4, 'supporting', 'claim'));
    const result = assess(SAE_V2, claimsOnly);
    expect(result.backedScore).toBe(0);
    expect(result.upperBound).toBeGreaterThan(0);
    expect(result.missingCritical).toEqual([LLM, RETRIEVAL, PYTHON, PRODUCT]);
  });
});

describe('Scenario: A new claim moves only the range', () => {
  it("Arjun's backed score stays when a claim for Arabic NLP arrives; only the upper bound rises", () => {
    const before = assess(SAE_V2, ARJUN);
    const after = assess(SAE_V2, [...ARJUN, link('arjun-arabic-claim', ARABIC, 3, 'claim', 'claim')]);
    expect([before.backedScore, before.upperBound]).toEqual([56, 65]);
    expect(after.backedScore).toBe(before.backedScore);
    expect(after.upperBound).toBe(71);
  });

  // SAFETY: mutation check: counted claim links in the proven level (counts() returning true) -> this test failed
  it('property: adding any claim to any evidence never changes the backed score', () => {
    let seed = 7;
    const next = () => (seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648) / 2_147_483_648;
    const pick = <T>(list: readonly T[]) => list[Math.floor(next() * list.length)] as T;
    const ids = SAE_V2.competencies.map((c) => c.id);
    for (let run = 0; run < 500; run++) {
      const evidence = Array.from({ length: Math.floor(next() * 8) }, (_, i) =>
        link(`e${run}-${i}`, pick(ids), Math.floor(next() * 6), pick(STRENGTHS), pick(PROVENANCES)),
      ).filter(
        (l) => !['claim', 'awaiting-defence'].includes(l.provenance) || ['supporting', 'claim'].includes(l.strength),
      );
      const claim = link(`c${run}`, pick(ids), Math.floor(next() * 6), pick(['supporting', 'claim'] as const), 'claim');
      expect(assess(SAE_V2, [...evidence, claim]).backedScore).toBe(assess(SAE_V2, evidence).backedScore);
      expect(assess(SAE_V2, [...evidence, claim]).upperBound).toBeGreaterThanOrEqual(
        assess(SAE_V2, evidence).upperBound,
      );
    }
  });
});

describe('what counts as proven', () => {
  it.each([
    ['strong', 'corroborated', true],
    ['strong', 'submitted', true],
    ['medium', 'submitted', true],
    ['medium', 'contradictory', false],
    ['strong', 'awaiting-defence', false],
    ['supporting', 'corroborated', true],
    ['supporting', 'submitted', false],
    ['supporting', 'claim', false],
    ['claim', 'claim', false],
    ['claim', 'corroborated', false],
  ] as const)('%s and %s: %s', (strength, provenance, expected) => {
    expect(counts({ strength, provenance })).toBe(expected);
  });

  it('a level outside 0–5 is refused', () => {
    expect(() => assess(SAE_V2, [link('x', LLM, 6, 'strong', 'corroborated')])).toThrow(RangeError);
  });

  it('links to a competency outside the rubric version are ignored', () => {
    expect(assess(SAE_V2, [link('x', 'other-job-competency', 5, 'strong', 'corroborated')]).backedScore).toBe(0);
  });
});

describe('Scenario: Every non-zero level cites evidence', () => {
  it('each competency proven above 0 lists at least one item id, sorted', () => {
    const result = assess(SAE_V2, [...SARA, link('sara-second', LLM, 4, 'medium', 'submitted')]);
    for (const c of result.competencies) if (c.proven.level > 0) expect(c.proven.itemIds.length).toBeGreaterThan(0);
    expect(of(result, LLM)?.proven.itemIds).toEqual(['sara-merchant', 'sara-second']);
  });

  it('a counting item at level 0 proves nothing and is not cited', () => {
    expect(of(assess(SAE_V2, [link('x', LLM, 0, 'strong', 'corroborated')]), LLM)?.proven).toEqual({
      level: 0,
      itemIds: [],
    });
  });
});

describe('Scenario Outline: Confidence follows how much weight rests on strong evidence', () => {
  it.each([
    [0.7, 'High'],
    [0.4, 'Medium'],
    [0.1, 'Low'],
  ] as const)('%s of the weight backed by Strong evidence is %s', (share, confidence) => {
    expect(confidenceFor(share)).toBe(confidence);
  });

  it('end to end: Strong work on 70% of the weight is High', () => {
    // 25 + 20 + 15 + 10 = 70 by Strong items.
    const strong = [LLM, RETRIEVAL, PYTHON, ARABIC].map((id) => link(`s-${id}`, id, 3, 'strong', 'corroborated'));
    expect(assess(SAE_V2, strong).confidence).toBe('High');
  });
});

describe('Scenario: Same input, same output', () => {
  it('assessing twice, or with the links in another order, gives identical results', () => {
    expect(assess(SAE_V2, SARA)).toEqual(assess(SAE_V2, SARA));
    expect(assess(SAE_V2, SARA.toReversed())).toEqual(assess(SAE_V2, SARA));
  });
});
