import type { Interview } from '@credalent/interviews';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { countOngoingInterviews, loadInterviews } from './loadInterviews.ts';

// AIV-P2-002: the Interviews list's read, with the workspace context and every module faked. Synthetic cast and ids only.
const ME = 'u-me';
const CPO = 'u-cpo';
const ctx = { userId: ME, workspaceId: 'w1', role: 'recruiter', tx: {} };
const fake = vi.hoisted(() => ({
  list: vi.fn(),
  job: vi.fn(),
  applicants: vi.fn(),
  rubric: vi.fn(),
  membership: vi.fn(),
  user: vi.fn(),
  workspace: vi.fn(),
}));
vi.mock('@/server/workspace', () => ({
  inActiveWorkspace: (fn: (c: typeof ctx) => Promise<unknown>) => fake.workspace(fn),
  getWorkspaces: () => ({ getMembership: fake.membership }),
}));
vi.mock('@/server/interviews', () => ({ getInterviews: () => ({ listInterviews: fake.list }) }));
vi.mock('@/server/intake', () => ({ getIntake: () => ({ listApplicationsForJob: fake.applicants }) }));
vi.mock('@/server/jobs', () => ({
  getApprovedRubricReads: () => ({ approvedRubric: fake.rubric }),
  getJobs: () => ({ getJob: fake.job }),
}));
vi.mock('@/server/auth', () => ({ getIdentity: () => ({ getUser: fake.user }) }));

const interview = (over: Partial<Interview>): Interview => ({
  id: 'i1',
  workspaceId: 'w1',
  applicationId: 'a-daniel',
  jobId: 'j-ai',
  candidateId: 'p-daniel',
  round: 'structured_screen',
  interviewerUserId: ME,
  scheduledAt: null,
  status: 'to_schedule',
  rubricVersionId: 'v2',
  competencyIds: ['c1', 'c2'],
  createdBy: ME,
  createdAt: new Date('2026-11-14T08:00:00Z'),
  ...over,
});

const done = (id: string, candidateId: string, jobId: string) =>
  interview({ id, candidateId, jobId, status: 'completed' });

const inWorkspace = () =>
  fake.workspace.mockImplementation(async (fn: (c: typeof ctx) => Promise<unknown>) => ({ value: await fn(ctx) }));

afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});

describe('loadInterviews', () => {
  it('names each interview from the modules that own the names, on the viewer’s day', async () => {
    // 09:00 on 18 Nov in the Gulf: the Interviews artboard's "today".
    vi.useFakeTimers({ now: new Date('2026-11-18T05:00:00Z') });
    inWorkspace();
    const daniel = interview({ status: 'in_progress', scheduledAt: new Date('2026-11-18T10:00:00Z') });
    const anjali = interview({
      id: 'i2',
      applicationId: 'a-anjali',
      candidateId: 'p-anjali',
      interviewerUserId: CPO,
      status: 'scorecard_due',
      scheduledAt: new Date('2026-11-16T07:00:00Z'),
      // Planned on a version since replaced: its competency names are not the approved rubric's to give.
      rubricVersionId: 'v1',
    });
    // As the contract lists them, soonest first: the overdue 16 Nov interview leads; the page lists it after today's.
    fake.list.mockImplementation(async (_ctx, filter) => (filter === 'ongoing' ? [anjali, daniel] : []));
    fake.job.mockResolvedValue({ title: 'Senior AI Engineer' });
    fake.applicants.mockResolvedValue([
      { applicationId: 'a-daniel', displayName: 'Daniel Novak' },
      { applicationId: 'a-anjali', displayName: null },
    ]);
    fake.rubric.mockResolvedValue({
      id: 'v2',
      competencies: [
        { id: 'c1', name: 'Retrieval and evaluation' },
        { id: 'c2', name: 'Cost and reliability' },
      ],
    });
    fake.membership.mockResolvedValue({ title: 'CPO, Payments' });

    const data = await loadInterviews();

    expect(data?.ongoing).toEqual([
      {
        id: 'i1',
        candidate: 'Daniel Novak',
        job: 'Senior AI Engineer',
        round: 'structured_screen',
        interviewer: null,
        scheduledAt: '2026-11-18T10:00:00.000Z',
        today: true,
        status: 'in_progress',
        dueDays: null,
        competencies: ['Retrieval and evaluation', 'Cost and reliability'],
      },
      {
        id: 'i2',
        candidate: null,
        job: 'Senior AI Engineer',
        round: 'structured_screen',
        interviewer: 'CPO, Payments',
        scheduledAt: '2026-11-16T07:00:00.000Z',
        today: false,
        status: 'scorecard_due',
        dueDays: 2,
        competencies: [],
      },
    ]);
    expect(data).toMatchObject({ completed: [], people: 0, jobs: 0 });
    // One job, read once for both interviews; the signed-in member is never looked up to be called "You".
    expect(fake.job).toHaveBeenCalledOnce();
    expect(fake.membership).toHaveBeenCalledExactlyOnceWith(CPO, 'w1');
    expect(fake.user).not.toHaveBeenCalled();
  });

  it('the summary counts the people and jobs of the completed interviews', async () => {
    inWorkspace();
    fake.list.mockImplementation(async (_ctx, filter) =>
      filter === 'completed' ? [done('i1', 'p1', 'j1'), done('i2', 'p1', 'j1'), done('i3', 'p2', 'j2')] : [],
    );
    fake.job.mockResolvedValue({ title: 'Senior AI Engineer' });
    fake.applicants.mockResolvedValue([]);
    fake.rubric.mockResolvedValue(null);
    expect(await loadInterviews()).toMatchObject({ ongoing: [], people: 2, jobs: 2 });
  });

  it('is null with no workspace', async () => {
    fake.workspace.mockResolvedValue(null);
    expect(await loadInterviews()).toBeNull();
  });
});

describe('countOngoingInterviews (the sidebar count)', () => {
  it('counts the ongoing list the page shows', async () => {
    inWorkspace();
    fake.list.mockResolvedValue([interview({}), interview({ id: 'i2' })]);
    expect(await countOngoingInterviews()).toBe(2);
    expect(fake.list).toHaveBeenCalledExactlyOnceWith(ctx, 'ongoing');
  });

  it('a failed read gives no count, never a made-up one, and logs no detail of the error', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    inWorkspace();
    fake.list.mockRejectedValue(new Error('Daniel Novak could not be read'));
    expect(await countOngoingInterviews()).toBeNull();
    expect(write.mock.calls.map(([chunk]) => String(chunk)).join('')).not.toContain('Daniel');
  });
});
