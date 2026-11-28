import { describe, expect, it } from 'vitest';
import { orderBasis } from './order.ts';
import { toCandidateRows, type CandidateRow } from './ranking.ts';

// AIV-P1-165 §9: when every backed score is 0, one banner says the order rests on claims. Opaque ids only.
const row = (id: string, score: { backedScore: number; upperBound: number; rank: number } | null): CandidateRow =>
  ({
    id: `a-${id}`,
    personId: `p-${id}`,
    name: null,
    stage: 'new',
    score: score && {
      ...score,
      meetsNeed: 0,
      competencyCount: 8,
      confidence: 'Low',
      assessedAt: new Date('2026-11-28T08:00:00.000Z'),
      missing: [],
      investigate: [],
    },
  }) as CandidateRow;

describe('orderBasis: the rule that ordered the ranking', () => {
  it('is "claims" when every assessed backed score is 0, whatever the unassessed rows', () => {
    expect(orderBasis([row('1', { backedScore: 0, upperBound: 69, rank: 1 }), row('2', null)])).toBe('claims');
  });

  it('is "backed" once anyone has a backed score above 0', () => {
    expect(
      orderBasis([
        row('1', { backedScore: 31, upperBound: 69, rank: 1 }),
        row('2', { backedScore: 0, upperBound: 77, rank: 2 }),
      ]),
    ).toBe('backed');
  });

  it('is "none" while nobody is assessed', () => {
    expect(orderBasis([row('1', null)])).toBe('none');
    expect(orderBasis([])).toBe('none');
  });

  // SAFETY: mutation check: made toCandidateRows drop rows whose backed score is 0 -> this test failed (2 rows, not 3)
  it('keeps every candidate in the list when every backed score is 0 (AGENTS.md 1.5)', () => {
    const applicants = ['1', '2', '3'].map((id) => ({
      applicationId: `a-${id}`,
      personId: `p-${id}`,
      displayName: null,
      stage: 'new',
    })) as unknown as Parameters<typeof toCandidateRows>[0];
    const ranking = ['1', '2'].map((id, i) => ({
      candidateId: `p-${id}`,
      rank: i + 1,
      backedScore: 0,
      upperBound: 70 - i,
      meetsNeed: 0,
      competencyCount: 8,
      confidence: 'Low' as const,
      missingCritical: [],
      gaps: [],
      cited: null,
      assessedAt: new Date('2026-11-28T08:00:00.000Z'),
    }));
    const rows = toCandidateRows(applicants, ranking, () => undefined);
    expect(rows.map((r) => r.personId)).toEqual(['p-1', 'p-2', 'p-3']);
    expect(orderBasis(rows)).toBe('claims');
  });
});
