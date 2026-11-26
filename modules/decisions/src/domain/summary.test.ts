import type { EvidenceItemView } from '@credalent/evidence';
import { describe, expect, it } from 'vitest';
import { FACTS_ID, memberSummary, sourcesOf } from './summary.ts';

// AIV-P2-011: the facts a pack member's summary reads, from their snapshot. Synthetic cast and opaque ids only.
const id = (n: number) => `0190d4a2-0000-7000-9000-${String(n).padStart(12, '0')}`;
const NAMES = new Map([
  ['llm', 'LLM systems in production'],
  ['rag', 'Retrieval and evaluation'],
  ['py', 'Python services'],
  ['cost', 'Cost and reliability'],
  ['product', 'Product judgement'],
  ['arabic', 'Arabic and bilingual NLP'],
]);
const item = (n: number, kind: EvidenceItemView['source']['kind'], provenance: string, excerpt: string) =>
  ({ id: id(n), provenance, excerpt, source: { kind, label: `Source ${n}` } }) as unknown as EvidenceItemView;
const competency = (
  competencyId: string,
  weightPercent: number,
  levelNeeded: number,
  proven: number,
  itemIds: string[],
  claimedLevel = proven,
  claimItemIds: string[] = [],
) => ({
  competencyId,
  weightPercent,
  levelNeeded,
  proven: (proven === 0 ? { level: 0, itemIds: [] } : { level: proven, itemIds }) as never,
  claimedLevel: claimedLevel as never,
  claimItemIds,
});

// Sara Al Qahtani's snapshot, as the golden case decisions.summariseMember/sara-advance reads it.
const SARA = [
  competency('arabic', 10, 3, 0, [], 4, [id(6)]),
  competency('llm', 25, 4, 4, [id(2)]),
  competency('rag', 20, 4, 5, [id(3), 'an-interview-id']),
  competency('py', 15, 3, 4, [id(4)]),
  competency('cost', 15, 3, 0, [], 3, [id(5)]),
  competency('product', 15, 3, 0, []),
];
const EVIDENCE = [
  item(2, 'repository', 'corroborated', 'authored 412 of 460 commits in llm-eval-harness between March and October'),
  item(3, 'repository', 'corroborated', 'deployed the retrieval service behind the merchant assistant'),
  item(4, 'document', 'submitted', 'design note for the order-status API'),
  item(5, 'cv', 'claim', 'cut the cost per request of the merchant assistant by 38%'),
  item(6, 'cv', 'claim', 'built Arabic intent classification for a bilingual support bot'),
  item(7, 'interview_note', 'submitted', 'Defended the evaluation design.'),
  item(8, 'repository', 'corroborated', 'not cited by the snapshot'),
];

describe('sourcesOf: the facts and excerpts a pack member is summarised from', () => {
  it("writes the golden case's facts, heaviest first: the share of the weight met, then each competency's level and what shows it", () => {
    const [facts] = sourcesOf(SARA, NAMES, EVIDENCE);
    expect(facts).toMatchObject({ id: FACTS_ID, label: 'Assessment', kind: 'document' });
    expect(facts?.text).toBe(
      [
        'Work meets the need on competencies holding 60% of the weight.',
        'LLM systems in production, 25% of the weight, needs level 4: independently checked work shows level 4, which meets the need.',
        'Retrieval and evaluation, 20% of the weight, needs level 4: independently checked work shows level 5, which meets the need.',
        'Python services, 15% of the weight, needs level 3: submitted work shows level 4, which meets the need.',
        'Cost and reliability, 15% of the weight, needs level 3: a claim with nothing to inspect, level 3 if it holds.',
        'Product judgement, 15% of the weight, needs level 3: no evidence yet.',
        'Arabic and bilingual NLP, 10% of the weight, needs level 3: a claim with nothing to inspect, level 4 if it holds.',
      ].join('\n'),
    );
  });

  it('a level short of the need says so, with what the claims would add', () => {
    const [facts] = sourcesOf([competency('rag', 100, 4, 2, [id(4)], 4, [id(5)])], NAMES, EVIDENCE);
    expect(facts?.text.split('\n')).toEqual([
      'Work meets the need on competencies holding 0% of the weight.',
      'Retrieval and evaluation, 100% of the weight, needs level 4: submitted work shows level 2, short of the need; claims would take it to level 4.',
    ]);
  });

  it('the excerpts are the items the snapshot cites, heaviest competency first, then the interview notes as `interview`; never an interview id or an uncited item', () => {
    const [, ...items] = sourcesOf(SARA, NAMES, EVIDENCE);
    expect(items.map((s) => [s.id, s.kind])).toEqual([
      [id(2), 'repo'],
      [id(3), 'repo'],
      [id(4), 'document'],
      [id(5), 'cv'],
      [id(6), 'cv'],
      [id(7), 'interview'],
    ]);
    expect(items[0]).toEqual({
      id: id(2),
      label: 'Source 2',
      kind: 'repo',
      text: 'authored 412 of 460 commits in llm-eval-harness between March and October',
    });
  });
});

describe('memberSummary: what a stored summary may hold', () => {
  const statement = { text: 'The candidate built it.', citations: [{ itemId: null, label: 'Assessment', quote: 'q' }] };
  const summary = {
    strengths: [statement],
    risks: [],
    round1: null,
    recommendation: { action: 'advance', focus: null, citations: statement.citations },
  };

  it('a statement or a recommendation with no citation, or a recommendation to reject, is not a summary', () => {
    expect(memberSummary.safeParse(summary).success).toBe(true);
    expect(memberSummary.safeParse({ ...summary, strengths: [{ ...statement, citations: [] }] }).success).toBe(false);
    expect(
      memberSummary.safeParse({ ...summary, recommendation: { ...summary.recommendation, citations: [] } }).success,
    ).toBe(false);
    expect(
      memberSummary.safeParse({ ...summary, recommendation: { ...summary.recommendation, action: 'reject' } }).success,
    ).toBe(false);
  });
});
