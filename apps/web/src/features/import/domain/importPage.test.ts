import type { Job, JobHeader, RubricVersion } from '@credalent/jobs';
import { describe, expect, it } from 'vitest';
import { importView, type PickerJob } from './importPage.ts';

// AIV-P1-101: the picker's labels. Synthetic opaque ids only.
const SAE = '0190d4a2-0000-7000-9000-000000001031';
const SPD = '0190d4a2-0000-7000-9000-000000001035';
const jobs: PickerJob[] = [
  { id: SAE, title: 'Senior AI Engineer', rubric: { approved: true, latest: 'approved' } },
  {
    id: '0190d4a2-0000-7000-9000-000000001032',
    title: 'QA Automation Engineer',
    rubric: { approved: true, latest: 'draft' },
  },
  { id: SPD, title: 'Senior Product Designer', rubric: { approved: false, latest: 'awaiting_approval' } },
  { id: '0190d4a2-0000-7000-9000-000000001036', title: 'Data Analyst', rubric: { approved: false, latest: null } },
  { id: '0190d4a2-0000-7000-9000-000000001037', title: 'Data Engineer', rubric: { approved: false, latest: 'draft' } },
  {
    id: '0190d4a2-0000-7000-9000-000000001038',
    title: 'ML Engineer',
    rubric: { approved: false, latest: 'returned' },
  },
];
const header = (id: string, approvedVersion: number | null): JobHeader => ({
  job: { id } as Job,
  approved: approvedVersion === null ? null : ({ version: approvedVersion } as RubricVersion),
  latest: null,
  publicSlug: null,
});

describe('Bring in candidates (AIV-P1-101)', () => {
  it('Scenario: The page for Senior AI Engineer: the picker is set to it with its approved version', () => {
    const view = importView(jobs, header(SAE, 2));
    expect(view.jobId).toBe(SAE);
    expect(view.options.map((o) => [o.label.key, o.label.values.title])).toEqual([
      ['approvedVersion', 'Senior AI Engineer'],
      // A newer draft does not unapprove the version in force.
      ['approved', 'QA Automation Engineer'],
      // Only a version sent for approval is waiting; no rubric, a draft never sent and a returned one say so.
      ['waiting', 'Senior Product Designer'],
      ['none', 'Data Analyst'],
      ['draft', 'Data Engineer'],
      ['returned', 'ML Engineer'],
    ]);
    expect(view.options[0]?.label.values).toEqual({ title: 'Senior AI Engineer', version: 2 });
  });

  it('Scenario: Importing into a job whose rubric is waiting: it is the value, still "waiting", with no version', () => {
    const view = importView(jobs, header(SPD, null));
    expect(view.jobId).toBe(SPD);
    expect(view.options.find((o) => o.id === SPD)?.label).toEqual({
      key: 'waiting',
      values: { title: 'Senior Product Designer' },
    });
    // Only the open job names its version: the others come from the Jobs list's rubric state.
    expect(view.options.find((o) => o.id === SAE)?.label.key).toBe('approved');
  });
});
