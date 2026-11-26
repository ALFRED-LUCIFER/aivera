import type { Job, JobHeader, RubricVersion } from '@credalent/jobs';
import { describe, expect, it } from 'vitest';
import { jobHeaderView, parseJobPage } from './jobHeader.ts';

const job = { id: 'j1', title: 'Senior AI Engineer', team: 'Engineering', location: 'DIFC, Dubai' } as Job;
const saved = new Date('2026-11-03T08:00:00.000Z');
const version = (n: number, status: RubricVersion['status']) => ({ version: n, status }) as RubricVersion;
const header = (more: Partial<JobHeader>): JobHeader => ({
  job: { ...job, createdAt: saved },
  approved: null,
  latest: null,
  publicSlug: null,
  ...more,
});
const lines = (h: JobHeader, assessed = 0) =>
  Object.fromEntries(jobHeaderView(h, null, assessed, null, 0, false).stages.map((s) => [s.page, s.line]));

describe('Job header stage lines (AIV-P1-011)', () => {
  it('Senior AI Engineer, version 2 approved with 64 assessed', () => {
    const view = jobHeaderView(
      header({ approved: version(2, 'approved'), latest: version(2, 'approved') }),
      'Head of Engineering',
      64,
      null,
      0,
      false,
    );
    expect(view).toMatchObject({ hiringOwner: 'Head of Engineering', assessed: 64, rubric: { approved: true } });
    expect(Object.fromEntries(view.stages.map((s) => [s.page, s.line]))).toEqual({
      description: { key: 'saved', values: { date: saved } },
      rubric: { key: 'approved', values: { version: 2 } },
      import: { key: 'notStarted' },
      candidates: { key: 'assessed', values: { count: 64 } },
      interviews: { key: 'notStarted' },
      pack: { key: 'notStarted' },
    });
    expect(view.stages.filter((s) => s.done).map((s) => s.page)).toEqual(['description', 'rubric']);
  });

  it('an approved version stays the rubric line while a newer one waits for approval', () => {
    const h = header({ approved: version(2, 'approved'), latest: version(3, 'awaiting_approval') });
    expect(lines(h)).toMatchObject({
      rubric: { key: 'approved', values: { version: 2 } },
      candidates: { key: 'notStarted' },
    });
  });

  it('a draft rubric: evidence and ranking starts after approval, and the rubric is not done', () => {
    const view = jobHeaderView(header({ latest: version(1, 'draft') }), null, 0, null, 0, false);
    expect(Object.fromEntries(view.stages.map((s) => [s.page, s.line]))).toMatchObject({
      rubric: { key: 'draft', values: { version: 1 } },
      candidates: { key: 'afterApproval' },
    });
    expect(view.rubric).toEqual({ approved: false, latest: 'draft' });
    expect(view.stages.filter((s) => s.done).map((s) => s.page)).toEqual(['description']);
  });

  it('no rubric yet reads "Not started"', () => {
    expect(lines(header({}))).toMatchObject({ rubric: { key: 'notStarted' }, candidates: { key: 'afterApproval' } });
  });

  it('AIV-P1-101: "Bring in candidates" counts applications from every source, before the rubric is approved too', () => {
    const draft = header({ latest: version(1, 'draft') });
    const line = (imported: number) => jobHeaderView(draft, null, 0, null, imported, false).stages[2];
    expect(line(212)).toEqual({ page: 'import', line: { key: 'imported', values: { count: 212 } }, done: false });
    expect(line(0)?.line).toEqual({ key: 'notStarted' });
  });

  it('AIV-P2-011: the Decision stage reads "Shortlist ready" while the job has an undecided pack', () => {
    const approved = header({ approved: version(2, 'approved') });
    expect(jobHeaderView(approved, null, 3, null, 3, true).stages[5]?.line).toEqual({ key: 'shortlistReady' });
    expect(jobHeaderView(approved, null, 3, null, 3, false).stages[5]?.line).toEqual({ key: 'notStarted' });
  });

  it('only the stage segments are a current page', () => {
    expect(parseJobPage('import')).toBe('import');
    expect(parseJobPage('rubric')).toBe('rubric');
    // A pack's own page sits under the Decision stage (AIV-P2-010).
    expect(parseJobPage('packs')).toBe('pack');
    expect(parseJobPage('settings')).toBeNull();
    expect(parseJobPage(null)).toBeNull();
  });
});
