import { JobError } from '@credalent/jobs';
import { ForbiddenError } from '@credalent/workspaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nameSelfOwner } from './nameSelfOwner.ts';

// AIV-P1-165, owner decision (b): an admin names themselves a job's hiring owner from its pack. Jobs is replaced; its
// authorisation (`job.change_owner`, admins only) and audit are proven against PostgreSQL in tests/integration/src/jobs.test.ts.
const id = (n: number) => `0190d4a2-0000-7000-8000-${String(n).padStart(12, '0')}`;
const [JOB, AYESHA] = [id(1), id(6)];
const WHY = 'Solo recruiter: I decide this hire';
const jobs = { changeHiringOwner: vi.fn() };
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
  jobs.changeHiringOwner.mockResolvedValue(undefined);
});

describe('nameSelfOwner', () => {
  it('names the signed-in admin with the reason, and nothing else (no email: no alongside step)', async () => {
    expect(await nameSelfOwner({ jobId: JOB, reason: WHY })).toEqual({ ok: true });
    expect(jobs.changeHiringOwner).toHaveBeenCalledExactlyOnceWith({ userId: AYESHA, role: 'admin' }, JOB, AYESHA, {
      reason: WHY,
      onlyIfNone: true,
    });
  });

  // The row-locked check itself is proven in tests/integration/src/jobs.test.ts (onlyIfNone).
  it('a job that already has a hiring owner keeps them: "taken", nothing changed', async () => {
    jobs.changeHiringOwner.mockRejectedValueOnce(new JobError('owner_taken'));
    expect(await nameSelfOwner({ jobId: JOB, reason: WHY })).toEqual({ ok: false, error: 'taken' });
  });

  it('a blank reason or a malformed job id is refused before anything is read', async () => {
    expect(await nameSelfOwner({ jobId: JOB, reason: ' ' })).toEqual({ ok: false, error: 'invalid' });
    expect(await nameSelfOwner({ jobId: 'job-1', reason: WHY })).toEqual({ ok: false, error: 'invalid' });
    expect(jobs.changeHiringOwner).not.toHaveBeenCalled();
  });

  it('a member who may not change the owner gets the 403 page; a job the workspace cannot see, the 404', async () => {
    jobs.changeHiringOwner.mockRejectedValueOnce(new ForbiddenError());
    await expect(nameSelfOwner({ jobId: JOB, reason: WHY })).rejects.toThrow('403');
    jobs.changeHiringOwner.mockRejectedValueOnce(new JobError('not_found'));
    await expect(nameSelfOwner({ jobId: JOB, reason: WHY })).rejects.toThrow('404');
  });
});
