import { IntakeError } from '@credalent/intake';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadApplicants } from './loadApplicants.ts';

// AIV-P1-086: the Candidates tab's read, with the workspace context and intake faked. Synthetic cast and ids only.
const JOB = '0190d4a2-0000-7000-9000-000000001031';
const ctx = { userId: 'u1', workspaceId: '0190d4a2-0000-7000-8000-000000000001', role: 'recruiter' };
const fake = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('@/server/workspace', () => ({
  inActiveWorkspace: async (fn: (c: typeof ctx) => Promise<unknown>) => ({ value: await fn(ctx) }),
}));
vi.mock('@/server/intake', () => ({ getIntake: () => ({ listApplicationsForJob: fake.list }) }));

const row = {
  applicationId: '0190d4a2-0000-7000-8000-0000000000a1',
  personId: '0190d4a2-0000-7000-8000-0000000000b1',
  displayName: 'Sara Al Qahtani',
  receivedAt: new Date('2026-11-14T08:00:00.000Z'),
  source: 'linkedin',
};

afterEach(() => vi.restoreAllMocks());

describe('loadApplicants', () => {
  it('Scenario: No personal data in URLs or logs: the log line carries the job id and a count, never a name', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    fake.list.mockResolvedValue([row]);
    expect(await loadApplicants(JOB)).toEqual([row]);
    expect(fake.list).toHaveBeenCalledWith(ctx, JOB);
    const lines = write.mock.calls.map(([chunk]) => String(chunk));
    expect(lines.join('')).not.toContain('Sara');
    const logged = lines
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .find((l) => l['msg'] === 'applicants listed');
    expect(logged).toMatchObject({ area: 'candidates', jobId: JOB, 'credalent.intake.applications': 1 });
  });

  it('a job the member cannot see, or a malformed id, is null (the page answers 404)', async () => {
    fake.list.mockRejectedValue(new IntakeError('job_not_found'));
    expect(await loadApplicants(JOB)).toBeNull();
    fake.list.mockClear();
    expect(await loadApplicants('not-a-uuid')).toBeNull();
    expect(fake.list).not.toHaveBeenCalled();
  });

  it('any other failure reaches the error state', async () => {
    fake.list.mockRejectedValue(new Error('connection lost'));
    await expect(loadApplicants(JOB)).rejects.toThrow('connection lost');
  });
});
