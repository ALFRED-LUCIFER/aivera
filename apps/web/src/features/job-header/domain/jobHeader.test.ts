import type { Job, JobHeader, RubricVersion } from '@aivera/jobs';
import { describe, expect, it } from 'vitest';
import { jobHeaderView, parseJobPage } from './jobHeader.ts';

const job = { id: 'j1', title: 'Senior AI Engineer', team: 'Engineering', location: 'DIFC, Dubai' } as Job;
const saved = new Date('2026-11-03T08:00:00.000Z');
const version = (n: number, status: RubricVersion['status']) => ({ version: n, status }) as RubricVersion;
const header = (more: Partial<JobHeader>): JobHeader => ({
  job: { ...job, createdAt: saved },
  approved: null,
  latest: null,
  assessed: 0,
  publicSlug: null,
  ...more,
});
const lines = (h: JobHeader) => Object.fromEntries(jobHeaderView(h, null).stages.map((s) => [s.page, s.line]));

describe('Job header stage lines (AIV-P1-011)', () => {
  it('Senior AI Engineer, version 2 approved with 64 assessed', () => {
    const view = jobHeaderView(
      header({ approved: version(2, 'approved'), latest: version(2, 'approved'), assessed: 64 }),
      'Head of Engineering',
    );
    expect(view).toMatchObject({ hiringOwner: 'Head of Engineering', assessed: 64, rubric: { approved: true } });
    expect(Object.fromEntries(view.stages.map((s) => [s.page, s.line]))).toEqual({
      description: { key: 'saved', values: { date: saved } },
      rubric: { key: 'approved', values: { version: 2 } },
      candidates: { key: 'assessed', values: { count: 64 } },
      interviews: { key: 'notStarted' },
      pack: { key: 'notStarted' },
    });
    expect(view.stages.filter((s) => s.done).map((s) => s.page)).toEqual(['description', 'rubric']);
  });

  it('an approved version stays the rubric line while a newer one waits for approval', () => {
    const h = header({ approved: version(2, 'approved'), latest: version(3, 'awaiting_approval'), assessed: null });
    expect(lines(h)).toMatchObject({
      rubric: { key: 'approved', values: { version: 2 } },
      candidates: { key: 'notStarted' },
    });
  });

  it('a draft rubric: evidence and ranking starts after approval, and the rubric is not done', () => {
    const view = jobHeaderView(header({ latest: version(1, 'draft') }), null);
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

  it('only the five stage segments are a current page', () => {
    expect(parseJobPage('rubric')).toBe('rubric');
    expect(parseJobPage('settings')).toBeNull();
    expect(parseJobPage(null)).toBeNull();
  });
});
