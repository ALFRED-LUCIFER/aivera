import { CandidateError } from '@credalent/candidates';
import { IntakeError } from '@credalent/intake';
import { ForbiddenError } from '@credalent/workspaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { correctName } from './correctName.ts';

// AIV-P1-165 §8: the "Correct name" action. Intake and candidates are replaced; their roles, the audit entry and
// row-level security are proven against PostgreSQL in tests/integration/src/candidates.test.ts.
const CANDIDATE = '0190d4a2-0000-7000-8000-0000000000a1';
const JOB = '0190d4a2-0000-7000-9000-000000001031';
const input = { candidateId: CANDIDATE, jobId: JOB, name: ' Maria Santos ', reason: 'Typo in read name' };
const ctx = {};
const intake = vi.hoisted(() => ({ listApplicationsForJob: vi.fn() }));
const candidates = vi.hoisted(() => ({ correctName: vi.fn() }));
const logged = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn() }));
vi.mock('@/server/intake', () => ({ getIntake: () => intake }));
vi.mock('@/server/people', () => ({ getCandidates: () => candidates }));
vi.mock('@credalent/observability', () => ({ log: logged }));
vi.mock('@/server/workspace', () => ({
  inActiveWorkspace: async (fn: (c: object) => unknown) => ({ value: await fn(ctx) }),
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
  intake.listApplicationsForJob.mockResolvedValue([{ personId: CANDIDATE }]);
});

describe('the "Correct name" action', () => {
  it("corrects the name of the job's applicant, trimmed, with the reason", async () => {
    expect(await correctName(input)).toEqual({ ok: true });
    expect(intake.listApplicationsForJob).toHaveBeenCalledWith(ctx, JOB);
    expect(candidates.correctName).toHaveBeenCalledWith(ctx, CANDIDATE, {
      name: 'Maria Santos',
      reason: 'Typo in read name',
    });
  });

  // SAFETY: mutation check: logged `name` with the ids -> this test failed
  it('logs opaque ids only: never the name or the reason (AGENTS.md 1.2)', async () => {
    await correctName(input);
    candidates.correctName.mockRejectedValueOnce(new Error('Maria Santos could not be saved'));
    await correctName(input);
    const lines = JSON.stringify([...logged.info.mock.calls, ...logged.error.mock.calls]);
    expect(lines).toContain(CANDIDATE);
    expect(lines).not.toMatch(/Maria|Santos|Typo/);
  });

  it.each([
    { ...input, reason: ' ' },
    { ...input, name: '' },
    { ...input, candidateId: 'not-a-uuid' },
    { ...input, name: 'M'.repeat(201) },
    { ...input, workspaceId: '0190d4a2-0000-7000-8000-00000000000f' },
  ])('refuses an input with no reason, no name or anything else before anything runs (%#)', async (bad) => {
    expect(await correctName(bad)).toEqual({ ok: false, error: 'invalid' });
    expect(intake.listApplicationsForJob).not.toHaveBeenCalled();
    expect(candidates.correctName).not.toHaveBeenCalled();
  });

  // SAFETY: mutation check: dropped the applicant check -> this test failed (the name was corrected)
  it('a candidate who did not apply to the job is not found, and nothing is renamed', async () => {
    intake.listApplicationsForJob.mockResolvedValue([{ personId: '0190d4a2-0000-7000-8000-0000000000a2' }]);
    await expect(correctName(input)).rejects.toThrow('404');
    expect(candidates.correctName).not.toHaveBeenCalled();
  });

  // SAFETY: mutation check: dropped `if (error instanceof ForbiddenError) forbidden()` -> this test failed ('failed')
  it('a hiring owner or interviewer, whom candidates refuses, gets the 403 page', async () => {
    candidates.correctName.mockRejectedValueOnce(new ForbiddenError());
    await expect(correctName(input)).rejects.toThrow('403');
  });

  it("another workspace's job is not found", async () => {
    intake.listApplicationsForJob.mockRejectedValueOnce(new IntakeError('job_not_found'));
    await expect(correctName(input)).rejects.toThrow('404');
  });

  it('a person merged into another is not found', async () => {
    candidates.correctName.mockRejectedValueOnce(new CandidateError('person_not_found'));
    await expect(correctName(input)).rejects.toThrow('404');
  });

  it('a failure says nothing was changed', async () => {
    candidates.correctName.mockRejectedValueOnce(new Error('connection lost'));
    expect(await correctName(input)).toEqual({ ok: false, error: 'failed' });
  });
});
