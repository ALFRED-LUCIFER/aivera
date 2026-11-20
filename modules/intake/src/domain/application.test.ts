import { describe, expect, it } from 'vitest';
import { STAGES } from './application.ts';

describe('Scenario: There is no automatic rejection stage', () => {
  // SAFETY: mutation check: added 'rejected' to STAGES -> this test failed
  it('the stage enum has no value meaning rejected', () => {
    expect(STAGES).toEqual(['new', 'first_pass_done', 'assessing', 'in_process', 'in_pool', 'withdrawn']);
    expect(STAGES.filter((s) => /reject|declin|fail|disqualif/.test(s))).toEqual([]);
  });
});
