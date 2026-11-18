import { describe, expect, it } from 'vitest';
import { filterCounts, filterJobs, jobHref, parseFilter, rubricLabel, type JobRow } from './jobsList.ts';

const row = (title: string, more: Partial<JobRow>): JobRow => ({
  id: title,
  title,
  team: null,
  location: null,
  stage: 'collecting_evidence',
  rubric: { approved: true, latest: 'approved' },
  assessed: null,
  coveragePercent: null,
  nextAction: null,
  hiringOwner: null,
  ...more,
});

const rows = [
  row('Senior AI Engineer', { stage: 'round_1', nextAction: { kind: 'decide_shortlist' } }),
  row('QA Automation Engineer', { nextAction: { kind: 'chase_evidence', count: 3 } }),
  row('Staff Backend Engineer', { rubric: { approved: true, latest: 'awaiting_approval' } }),
  row('Platform Engineer', {
    stage: 'defining_rubric',
    rubric: { approved: false, latest: 'awaiting_approval' },
    assessed: 0,
    nextAction: { kind: 'rubric_approval_pending' },
  }),
  row('Senior Product Designer', {
    stage: 'defining_rubric',
    rubric: { approved: false, latest: 'draft' },
    assessed: 0,
    nextAction: { kind: 'send_rubric' },
  }),
];

describe('Jobs list filters', () => {
  it('count every job, the ones needing the recruiter, and the ones without an approved rubric', () => {
    expect(filterCounts(rows)).toEqual({ all: 5, needsAction: 3, rubricNotApproved: 2 });
  });

  it('"Needs your action" leaves out a rubric waiting on the hiring owner and jobs with no known action', () => {
    expect(filterJobs(rows, 'needsAction').map((r) => r.title)).toEqual([
      'Senior AI Engineer',
      'QA Automation Engineer',
      'Senior Product Designer',
    ]);
  });

  it('"Rubric not approved" lists only jobs with no version in force', () => {
    expect(filterJobs(rows, 'rubricNotApproved').map((r) => r.title)).toEqual([
      'Platform Engineer',
      'Senior Product Designer',
    ]);
  });

  it('an unknown filter in the URL reads as "All"', () => {
    expect(parseFilter('rubricNotApproved')).toBe('rubricNotApproved');
    expect(parseFilter('anything')).toBe('all');
    expect(parseFilter(null)).toBe('all');
  });
});

describe('Rubric label and job link', () => {
  it.each([
    [{ approved: true, latest: 'awaiting_approval' }, 'approved'],
    [{ approved: false, latest: 'awaiting_approval' }, 'awaiting_approval'],
    [{ approved: false, latest: 'returned' }, 'returned'],
    [{ approved: false, latest: 'draft' }, 'draft'],
    [{ approved: false, latest: null }, 'draft'],
  ] as const)('%j reads %s', (rubric, label) => {
    expect(rubricLabel(rubric)).toBe(label);
  });

  it('opens the rubric until one is approved, then the ranked candidates', () => {
    expect(jobHref({ id: 'j1', rubric: { approved: false, latest: 'draft' } })).toBe('/app/jobs/j1/rubric');
    expect(jobHref({ id: 'j1', rubric: { approved: true, latest: 'approved' } })).toBe('/app/jobs/j1/candidates');
  });
});
