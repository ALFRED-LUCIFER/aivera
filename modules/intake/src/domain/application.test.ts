import { describe, expect, it } from 'vitest';
import { STAGES, stageAfter } from './application.ts';

describe('Scenario: There is no automatic rejection stage', () => {
  // SAFETY: mutation check: added 'rejected' to STAGES -> this test failed
  it('the stage enum has no value meaning rejected', () => {
    expect(STAGES).toEqual([
      'new',
      'first_pass_done',
      'assessing',
      'interview',
      'in_process',
      'in_pool',
      'withdrawn',
      'round2_shortlist',
      'not_advanced',
    ]);
    expect(STAGES.filter((s) => /reject|declin|fail|disqualif/.test(s))).toEqual([]);
  });
});

describe('Scenario: Record decisions (AIV-P2-012): the stage each decision leads to', () => {
  it('advance moves to the Round 2 shortlist, do not advance to not advanced, and hold keeps the stage', () => {
    expect(stageAfter('advance')).toBe('round2_shortlist');
    expect(stageAfter('do_not_advance')).toBe('not_advanced');
    expect(stageAfter('hold')).toBeNull();
  });
});
