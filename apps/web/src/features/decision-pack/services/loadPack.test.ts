import { ForbiddenError } from '@credalent/workspaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadJobPacks, loadPack } from './loadPack.ts';

// AIV-P2-010: the pack page's reads, with the workspace context, decisions, jobs and intake faked. Their own checks are
// proven against PostgreSQL in tests/integration/src/decisions.test.ts. Synthetic cast and ids only.
const id = (n: number) => `0190d4a2-0000-7000-9000-${String(n).padStart(12, '0')}`;
const [JOB, OTHER_JOB, PACK, V2] = [id(1), id(2), id(3), id(4)];
const at = new Date('2026-11-17T08:00:00.000Z');
const fake = vi.hoisted(() => ({
  workspace: true,
  getPack: vi.fn(),
  listPacks: vi.fn(),
  header: vi.fn(),
  applicants: vi.fn(),
}));
vi.mock('@/server/workspace', () => ({
  inActiveWorkspace: async (fn: (c: object) => Promise<unknown>) => (fake.workspace ? { value: await fn({}) } : null),
}));
vi.mock('@/server/decisions', () => ({ getDecisions: () => ({ getPack: fake.getPack, listPacks: fake.listPacks }) }));
vi.mock('@/server/jobs', () => ({ getJobs: () => ({ getJobHeader: fake.header }) }));
vi.mock('@/server/intake', () => ({ getIntake: () => ({ listApplicationsForJob: fake.applicants }) }));
vi.mock('next/navigation', () => ({
  forbidden: () => {
    throw new Error('NEXT_HTTP_ERROR_FALLBACK;403');
  },
}));

const stored = (jobId = JOB) => ({
  id: PACK,
  jobId,
  name: 'Round 2 shortlist',
  rubricVersionId: V2,
  preparedAt: at,
  members: [{ candidateId: 'p1', backedScore: 68, upperBound: 84 }],
});

beforeEach(() => {
  vi.clearAllMocks();
  fake.workspace = true;
  fake.getPack.mockResolvedValue(stored());
  fake.header.mockResolvedValue({ job: { title: 'Senior AI Engineer' }, approved: { id: V2, version: 2 } });
  fake.applicants.mockResolvedValue([
    { personId: 'p1', displayName: 'Sara Al Qahtani' },
    { personId: 'p2', displayName: 'Arjun Menon' },
  ]);
});

describe('loadPack', () => {
  it('the pack with the job, its rubric version, each member by name, and how many others stay in the ranking', async () => {
    expect(await loadPack(JOB, PACK)).toEqual({
      jobId: JOB,
      name: 'Round 2 shortlist',
      job: 'Senior AI Engineer',
      preparedAt: at,
      rubricVersion: 2,
      members: [{ candidateId: 'p1', name: 'Sara Al Qahtani', backedScore: 68, upperBound: 84 }],
      others: 1,
    });
  });

  it('no rubric version once the job has approved another', async () => {
    fake.header.mockResolvedValue({ job: { title: 'Senior AI Engineer' }, approved: { id: id(9), version: 3 } });
    expect(await loadPack(JOB, PACK)).toMatchObject({ rubricVersion: null });
  });

  // SAFETY: mutation check: removed the `pack?.jobId !== jobId` check from loadPack -> this test failed (the pack was returned)
  it("a pack of another job under this job's address is not found, and nothing else is read", async () => {
    fake.getPack.mockResolvedValue(stored(OTHER_JOB));
    expect(await loadPack(JOB, PACK)).toBe('notFound');
    expect(fake.applicants).not.toHaveBeenCalled();
  });

  it('a missing pack, or a malformed id, is not found', async () => {
    fake.getPack.mockResolvedValue(null);
    expect(await loadPack(JOB, PACK)).toBe('notFound');
    fake.getPack.mockClear();
    expect(await loadPack('not-a-uuid', PACK)).toBe('notFound');
    expect(await loadPack(JOB, 'not-a-uuid')).toBe('notFound');
    expect(fake.getPack).not.toHaveBeenCalled();
  });

  it('an interviewer gets the 403 page; no workspace is null', async () => {
    fake.getPack.mockRejectedValue(new ForbiddenError());
    await expect(loadPack(JOB, PACK)).rejects.toThrow('403');
    fake.workspace = false;
    expect(await loadPack(JOB, PACK)).toBeNull();
  });
});

describe('loadJobPacks', () => {
  it("the job's undecided packs, each with its member count", async () => {
    fake.listPacks.mockResolvedValue([
      { id: PACK, name: 'Round 2 shortlist', status: 'ready', candidateIds: ['p1', 'p2'] },
      { id: id(5), name: 'Round 1 shortlist', status: 'decided', candidateIds: ['p3'] },
    ]);
    expect(await loadJobPacks(JOB)).toEqual([{ id: PACK, name: 'Round 2 shortlist', members: 2 }]);
  });

  it('an interviewer gets the 403 page; a malformed id is not found', async () => {
    fake.listPacks.mockRejectedValue(new ForbiddenError());
    await expect(loadJobPacks(JOB)).rejects.toThrow('403');
    expect(await loadJobPacks('not-a-uuid')).toBe('notFound');
  });
});
