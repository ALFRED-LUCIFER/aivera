import { describe, expect, it } from 'vitest';
import { canMove, DEFAULT_FOLLOW_UP, openClaims, REQUEST_STATUSES } from './request.ts';

const JOB = 'job-sae';
const item = (
  id: string,
  provenance: 'claim' | 'awaiting-defence' | 'corroborated' | 'submitted',
  competencyId: string,
  jobId = JOB,
) => ({
  id,
  excerpt: `excerpt ${id}`,
  provenance,
  competencies: [{ jobId, competencyId }],
});

describe('Scenario: Only a person can send', () => {
  // SAFETY: mutation check: TRANSITIONS.draft.sent set to 'system' -> this test failed
  it('the system can never move a draft, or anything else, to sent', () => {
    for (const from of REQUEST_STATUSES) expect(canMove(from, 'sent', 'system'), from).toBe(false);
    expect(canMove('draft', 'sent', 'user')).toBe(true);
  });

  it.each([
    ['sent', 'opened', 'system', true],
    ['sent', 'answered', 'system', true],
    ['opened', 'answered', 'system', true],
    ['opened', 'quiet', 'system', true],
    ['quiet', 'answered', 'system', true],
    ['sent', 'opened', 'user', false],
    ['draft', 'opened', 'system', false],
    ['draft', 'answered', 'system', false],
    ['answered', 'quiet', 'system', false],
    ['draft', 'closed', 'user', true],
    ['answered', 'closed', 'user', true],
    ['sent', 'closed', 'system', false],
    ['closed', 'draft', 'user', false],
    ['closed', 'sent', 'user', false],
  ] as const)('%s → %s by %s: %s', (from, to, actor, expected) => {
    expect(canMove(from, to, actor)).toBe(expected);
  });
});

describe('Scenario: A draft names only open claims', () => {
  it("Sara's two open claims, on Cost and reliability and Arabic NLP, and nothing else", () => {
    const sara = [
      item('merchant', 'corroborated', 'c-llm'),
      item('cost', 'claim', 'c-cost'),
      item('arabic', 'awaiting-defence', 'c-arabic'),
      item('serve', 'submitted', 'c-python'),
      item('elsewhere', 'claim', 'c-cost', 'another-job'),
    ];
    expect(openClaims(JOB, sara)).toEqual([
      { competencyId: 'c-cost', itemId: 'cost', claim: 'excerpt cost' },
      { competencyId: 'c-arabic', itemId: 'arabic', claim: 'excerpt arabic' },
    ]);
  });

  it('one line per competency: a second claim on the same competency adds none', () => {
    expect(openClaims(JOB, [item('a', 'claim', 'c-cost'), item('b', 'claim', 'c-cost')])).toHaveLength(1);
  });

  it('Hessa, with no open claims, has nothing to request', () => {
    expect(openClaims(JOB, [item('checkout', 'corroborated', 'c-tests')])).toEqual([]);
  });
});

describe('Scenario: Default follow-up policy', () => {
  it('follows up automatically after 2 days, at most twice', () => {
    expect(DEFAULT_FOLLOW_UP).toEqual({ afterDays: 2, maxCount: 2 });
  });
});
