import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadPeople } from './loadPeople.ts';

// AIV-P1-048: the all-candidates read, with the workspace context, jobs, intake, assessment and decisions faked.
// Synthetic cast and ids only.
const ctx = { userId: 'u1', workspaceId: '0190d4a2-0000-7000-8000-000000000001', role: 'recruiter', tx: {} };
const fake = vi.hoisted(() => ({
  interviews: vi.fn(async (_ctx: unknown, _filter: string): Promise<unknown[]> => []),
  workspace: vi.fn(),
  jobs: vi.fn(),
  list: vi.fn(),
  ranking: vi.fn(),
  packs: vi.fn(async (_ctx: unknown, _jobId: string): Promise<unknown[]> => []),
}));
vi.mock('@/server/workspace', () => ({ inActiveWorkspace: fake.workspace }));
vi.mock('@/server/jobs', () => ({ getJobs: () => ({ listJobs: fake.jobs }) }));
vi.mock('@/server/intake', () => ({ getIntake: () => ({ listApplicationsForJob: fake.list }) }));
vi.mock('@/server/assessment', () => ({ getAssessment: () => ({ listRanking: fake.ranking }) }));
vi.mock('@/server/decisions', () => ({ getDecisions: () => ({ listPacks: fake.packs }) }));
// AIV-P2-007: each application's current round; none unless a test sets them.
vi.mock('@/server/interviews', () => ({ getInterviews: () => ({ listInterviews: fake.interviews }) }));

const at = new Date('2026-11-14T08:00:00.000Z');
const applicant = (jobId: string) => ({
  applicationId: `a-${jobId}`,
  personId: 'p-sara',
  displayName: 'Sara Al Qahtani',
  stage: 'new',
  receivedAt: at,
});
const ranked = (backedScore: number) => ({
  candidateId: 'p-sara',
  rank: 1,
  backedScore,
  upperBound: backedScore + 16,
  meetsNeed: 4,
  competencyCount: 6,
  confidence: 'High',
  missingCritical: [],
  gaps: [],
  assessedAt: at,
});

afterEach(() => vi.clearAllMocks());

describe('loadPeople', () => {
  it('reads every open, ranked job in the active workspace and lists a person in two jobs once', async () => {
    fake.workspace.mockImplementation(async (fn: (c: typeof ctx) => Promise<unknown>) => ({ value: await fn(ctx) }));
    fake.jobs.mockResolvedValue([
      { id: 'j-ai', title: 'Senior AI Engineer', stage: 'round_1' },
      { id: 'j-be', title: 'Staff Backend Engineer', stage: 'collecting_evidence' },
      { id: 'j-old', title: 'Data Engineer', stage: 'closed' },
      { id: 'j-draft', title: 'Senior Product Designer', stage: 'defining_rubric' },
    ]);
    fake.ranking.mockImplementation(async (_ctx: unknown, jobId: string) =>
      jobId === 'j-draft'
        ? { status: 'awaiting_rubric' }
        : { status: 'ranked', rubricVersionId: 'v1', rows: [ranked(jobId === 'j-ai' ? 68 : 46)] },
    );
    fake.list.mockImplementation(async (_ctx: unknown, jobId: string) => [applicant(jobId)]);
    fake.packs.mockImplementation(async (_ctx: unknown, jobId: string) =>
      jobId === 'j-ai' ? [{ id: 'k1', name: 'Round 2', status: 'ready', candidateIds: ['p-sara'] }] : [],
    );

    const data = await loadPeople();

    // A closed job is not read at all; a job on a draft rubric is asked only for its (empty) ranking.
    expect(fake.ranking.mock.calls.map(([, jobId]) => jobId)).toEqual(['j-ai', 'j-be', 'j-draft']);
    expect(fake.list.mock.calls.map(([, jobId]) => jobId)).toEqual(['j-ai', 'j-be']);
    expect(data?.people).toHaveLength(1);
    expect(data?.people[0]?.job).toMatchObject({ jobTitle: 'Senior AI Engineer', row: { inPack: true } });
    expect(data?.people[0]?.others.map((j) => j.jobTitle)).toEqual(['Staff Backend Engineer']);
  });

  it('is null with no active workspace', async () => {
    fake.workspace.mockResolvedValue(null);
    expect(await loadPeople()).toBeNull();
    expect(fake.jobs).not.toHaveBeenCalled();
  });
});
