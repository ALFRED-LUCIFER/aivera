import { describe, expect, it } from 'vitest';
import type { CandidateRow } from './ranking.ts';
import { bulkActionsFor, compareState, parseSelected } from './selection.ts';

// AIV-P1-036. Synthetic ids only.
const rows = ['a1', 'a2', 'a3'].map((id): CandidateRow => ({
  id,
  personId: `p-${id}`,
  name: null,
  stage: 'new',
  score: null,
}));
const on = new Set(['compare']);

describe('bulkActionsFor', () => {
  // SAFETY: mutation check: dropped the role test from bulkActionsFor -> this test failed (an interviewer got 'compare')
  it('offers bulk actions to admins and recruiters only: interviewers and hiring owners get none', () => {
    expect(bulkActionsFor('admin', on)).toEqual(['compare', 'chooseForInterview', 'addToPack']);
    expect(bulkActionsFor('recruiter', on)).toEqual(['compare', 'chooseForInterview', 'addToPack']);
    expect(bulkActionsFor('interviewer', on)).toEqual([]);
    expect(bulkActionsFor('hiring_owner', on)).toEqual([]);
  });

  it('offers Compare with no flag on, now the comparison page exists (AIV-P1-047)', () => {
    expect(bulkActionsFor('recruiter', new Set())).toEqual(['compare', 'chooseForInterview', 'addToPack']);
  });
});

describe('parseSelected', () => {
  it('keeps only ids of this job’s rows, in rank order, whatever the URL says', () => {
    expect(parseSelected('a3,zz,a1,a1', rows)).toEqual(['a1', 'a3']);
    expect(parseSelected(null, rows)).toEqual([]);
    expect(parseSelected('', rows)).toEqual([]);
  });
});

describe('compare', () => {
  it('takes as many as the recruiter ticks, from two to ten', () => {
    expect([0, 1, 2, 3, 4, 10, 11].map(compareState)).toEqual([
      'tooFew',
      'tooFew',
      'ready',
      'ready',
      'ready',
      'ready',
      'tooMany',
    ]);
  });
});
