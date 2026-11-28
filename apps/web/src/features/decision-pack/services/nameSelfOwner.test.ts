import { ForbiddenError } from '@credalent/workspaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nameSelfOwner } from './nameSelfOwner.ts';

// AIV-P1-165, owner decision (b): an admin names themselves a job's hiring owner from its pack. Jobs is replaced; its
// authorisation (`job.change_owner`, admins only) and audit are proven against PostgreSQL in tests/integration/src/jobs.test.ts.
const id = (n: number) => `0190d4a2-0000-7000-8000-${String(n).padStart(12, '0')}`;
const [JOB, AYESHA, HASSAN] = [id(1), id(6), id(8)];
const WHY = 'Solo recruiter: I decide this hire';
const jobs = { getJob: vi.fn(), changeHiringOwner: vi.fn() };
vi.mock('@/server/jobs', () => ({ getJobs: () => jobs }));
vi.mock('@/server/workspace', () => ({
  inActiveWorkspace: async (fn: (ctx: object) => unknown) => ({ value: await fn({ userId: AYESHA, role: 'admin' }) }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  forbidden: () => {
    throw new Error('NEXT_HTTP_ERROR_FALLBACK;403');
  },
  notFound: () => {
    throw new Error('NEXT_HTTP_ERROR_FALLBACK;404');
  },
  unstable_rethrow: (error: unknown) => {
    if (error instanceof Error && error.message.startsWith('NEXT_')) throw error;
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  jobs.getJob.mockResolvedValue({ id: JOB, hiringOwnerUserId: null });
});

describe('nameSelfOwner', () => {
  it('names the signed-in admin with the reason, and nothing else (no email: no alongside step)', async () => {
    expect(await nameSelfOwner({ jobId: JOB, reason: WHY })).toEqual({ ok: true });
    expect(jobs.changeHiringOwner).toHaveBeenCalledExactlyOnceWith({ userId: AYESHA, role: 'admin' }, JOB, AYESHA, {
      reason: WHY,
    });
  });

  // SAFETY: mutation check: removed the `if (job.hiringOwnerUserId) return 'taken'` guard -> this test failed (Hassan replaced)
  it('never replaces a hiring owner already named on the job', async () => {
    jobs.getJob.mockResolvedValue({ id: JOB, hiringOwnerUserId: HASSAN });
    expect(await nameSelfOwner({ jobId: JOB, reason: WHY })).toEqual({ ok: false, error: 'taken' });
    expect(jobs.changeHiringOwner).not.toHaveBeenCalled();
  });

  it('a blank reason or a malformed job id is refused before anything is read', async () => {
    expect(await nameSelfOwner({ jobId: JOB, reason: ' ' })).toEqual({ ok: false, error: 'invalid' });
    expect(await nameSelfOwner({ jobId: 'job-1', reason: WHY })).toEqual({ ok: false, error: 'invalid' });
    expect(jobs.getJob).not.toHaveBeenCalled();
  });

  it('a member who may not change the owner gets the 403 page; a job the workspace cannot see, the 404', async () => {
    jobs.changeHiringOwner.mockRejectedValueOnce(new ForbiddenError());
    await expect(nameSelfOwner({ jobId: JOB, reason: WHY })).rejects.toThrow('403');
    jobs.getJob.mockResolvedValueOnce(null);
    await expect(nameSelfOwner({ jobId: JOB, reason: WHY })).rejects.toThrow('404');
  });
});
