import { describe, expect, it } from 'vitest';
import { approvalItems } from './desk.ts';

const row = (title: string, status: 'awaiting_approval' | 'approved', owner: string | null) => ({
  jobId: title,
  title,
  hiringOwnerUserId: owner,
  versionId: `${title}-v`,
  version: 2,
  status,
  approvedAt: null,
});

describe('My desk rubric approvals (AIV-P1-014)', () => {
  it('waiting items come first, with the owner named by title; an approved one is done', () => {
    const items = approvalItems(
      [row('Senior AI Engineer', 'approved', 'head'), row('Staff Backend Engineer', 'awaiting_approval', 'vp')],
      new Map([
        ['head', 'Head of Engineering'],
        ['vp', 'VP Engineering'],
      ]),
    );
    expect(items).toEqual([
      {
        jobId: 'Staff Backend Engineer',
        job: 'Staff Backend Engineer',
        version: 2,
        owner: 'VP Engineering',
        done: false,
      },
      { jobId: 'Senior AI Engineer', job: 'Senior AI Engineer', version: 2, owner: 'Head of Engineering', done: true },
    ]);
  });

  it('a job with no hiring owner, or one whose name cannot be read, names no one', () => {
    expect(approvalItems([row('QA', 'awaiting_approval', null)], new Map())[0]?.owner).toBeNull();
    expect(approvalItems([row('QA', 'awaiting_approval', 'x')], new Map([['x', '']]))[0]?.owner).toBeNull();
  });
});
