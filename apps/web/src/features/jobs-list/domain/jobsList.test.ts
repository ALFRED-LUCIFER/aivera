import { describe, expect, it } from 'vitest';
import {
  clientNames,
  filterByClient,
  filterCounts,
  filterJobs,
  jobHref,
  parseFilter,
  rubricLabel,
  type JobRow,
} from './jobsList.ts';

const row = (title: string, more: Partial<JobRow>): JobRow => ({
  id: title,
  title,
  team: null,
  location: null,
  stage: 'collecting_evidence',
  rubric: { approved: true, latest: 'approved' },
  assessed: 0,
  coveragePercent: null,
  nextAction: null,
  hiringOwner: null,
  client: null,
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
    nextAction: { kind: 'approve_rubric' },
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
    // Scenario: Send version 1 for approval from Add a job (AIV-P1-014): sent, it still reads "Draft, needs approval".
    [{ approved: false, latest: 'awaiting_approval' }, 'draft'],
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

describe('AIV-P1-056: the agency client filter', () => {
  const agency = [row('A', { client: 'Falcon Pay' }), row('B', { client: 'Dune Logistics' }), row('C', {})];
  it('offers each client named on a job, by name, and filters to it', () => {
    expect(clientNames(agency)).toEqual(['Dune Logistics', 'Falcon Pay']);
    expect(filterByClient(agency, 'Falcon Pay').map((r) => r.title)).toEqual(['A']);
    expect(filterByClient(agency, '')).toHaveLength(3);
  });
});
