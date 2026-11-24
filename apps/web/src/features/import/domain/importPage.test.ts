import type { Job, JobHeader, RubricVersion } from '@credalent/jobs';
import { describe, expect, it } from 'vitest';
import { importView, type PickerJob } from './importPage.ts';

// AIV-P1-101: the picker's labels and the footer. Synthetic opaque ids only.
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
];
const header = (id: string, published: boolean, approvedVersion: number | null): JobHeader => ({
  job: { id, published } as Job,
  approved: approvedVersion === null ? null : ({ version: approvedVersion } as RubricVersion),
  latest: null,
  publicSlug: null,
});

describe('Bring in candidates (AIV-P1-101)', () => {
  it('Scenario: The page for Senior AI Engineer: the picker is set to it with its approved version, and the footer counts 38', () => {
    const view = importView(jobs, header(SAE, true, 2), 38);
    expect(view.jobId).toBe(SAE);
    expect(view.options).toEqual([
      { id: SAE, label: { key: 'approvedVersion', values: { title: 'Senior AI Engineer', version: 2 } } },
      // A newer draft does not unapprove the version in force.
      { id: jobs[1]?.id, label: { key: 'approved', values: { title: 'QA Automation Engineer' } } },
      { id: SPD, label: { key: 'waiting', values: { title: 'Senior Product Designer' } } },
      { id: jobs[3]?.id, label: { key: 'waiting', values: { title: 'Data Analyst' } } },
    ]);
    expect(view.fromListing).toBe(38);
  });

  it('Scenario: Importing into a job whose rubric is waiting: it is the value, still "waiting", with no version', () => {
    const view = importView(jobs, header(SPD, false, null), 0);
    expect(view.jobId).toBe(SPD);
    expect(view.options.find((o) => o.id === SPD)?.label).toEqual({
      key: 'waiting',
      values: { title: 'Senior Product Designer' },
    });
    // Only the open job names its version: the others come from the Jobs list's rubric state.
    expect(view.options.find((o) => o.id === SAE)?.label.key).toBe('approved');
  });

  it('shows no footer while the job is not published, whatever came through the careers page before', () => {
    expect(importView(jobs, header(SAE, false, 2), 5).fromListing).toBeNull();
    expect(importView(jobs, header(SAE, true, 2), 0).fromListing).toBe(0);
  });
});
