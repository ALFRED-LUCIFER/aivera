import { describe, expect, it } from 'vitest';
import type { CandidateRow } from './ranking.ts';
import { bulkActionsFor, compareHref, compareState, parseSelected } from './selection.ts';

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
    expect(bulkActionsFor('admin', on)).toEqual(['compare', 'chooseForInterview']);
    expect(bulkActionsFor('recruiter', on)).toEqual(['compare', 'chooseForInterview']);
    expect(bulkActionsFor('interviewer', on)).toEqual([]);
    expect(bulkActionsFor('hiring_owner', on)).toEqual([]);
  });

  it('hides an action while its flag is off', () => {
    expect(bulkActionsFor('recruiter', new Set())).toEqual(['chooseForInterview']);
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
  it('needs two or three candidates', () => {
    expect([0, 1, 2, 3, 4].map(compareState)).toEqual(['tooFew', 'tooFew', 'ready', 'ready', 'tooMany']);
  });

  it('addresses the comparison by the job and the person ids', () => {
    expect(compareHref('j1', ['p1', 'p2'])).toBe('/app/jobs/j1/compare?ids=p1,p2');
  });
});
