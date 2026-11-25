import { IntakeError } from '@credalent/intake';
import { InterviewError } from '@credalent/interviews';
import { ForbiddenError } from '@credalent/workspaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chooseForInterview } from './chooseForInterview.ts';

// AIV-P1-114: the action a recruiter confirms a choice for interview with. Intake is replaced; its rules and role
// checks are proven against PostgreSQL in tests/integration/src/choose-for-interview.test.ts.
const JOB = '0190d4a2-0000-7000-9000-000000001031';
const DANIEL = '0190d4a2-0000-7000-8000-0000000000a1';
const PRIYA = '0190d4a2-0000-7000-8000-0000000000a2';
const intake = { chooseForInterview: vi.fn() };
vi.mock('@/server/intake', () => ({ getIntake: () => intake }));
vi.mock('@/server/workspace', () => ({
  inActiveWorkspace: async (fn: (ctx: object) => unknown) => ({ value: await fn({}) }),
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

const choose = () => chooseForInterview({ jobId: JOB, applicationIds: [DANIEL, PRIYA], reason: ' First shortlist ' });

beforeEach(() => vi.clearAllMocks());

describe('the choose-for-interview action', () => {
  it('a confirmed choice reaches intake with the job, ids and trimmed reason, and says how many were chosen', async () => {
    intake.chooseForInterview.mockResolvedValueOnce({
      chosen: [{ applicationId: PRIYA, interviewId: 'i1' }],
      skipped: [DANIEL],
    });
    expect(await choose()).toEqual({ ok: true, chosen: 1 });
    expect(intake.chooseForInterview).toHaveBeenCalledWith(
      {},
      { jobId: JOB, applicationIds: [DANIEL, PRIYA], reason: 'First shortlist' },
    );
  });

  // SAFETY: mutation check: dropped `if (error instanceof ForbiddenError) forbidden()` -> this test failed (came back as 'failed')
  it('a hiring owner or interviewer, whom intake refuses, gets the 403 page', async () => {
    intake.chooseForInterview.mockRejectedValueOnce(new ForbiddenError());
    await expect(choose()).rejects.toThrow('403');
  });

  it("another workspace's job is not found", async () => {
    intake.chooseForInterview.mockRejectedValueOnce(new IntakeError('job_not_found'));
    await expect(choose()).rejects.toThrow('404');
  });

  it('an application of another job, or a refusal of the interviews module, comes back without a change', async () => {
    intake.chooseForInterview.mockRejectedValueOnce(new IntakeError('not_on_job'));
    expect(await choose()).toEqual({ ok: false, error: 'notOnJob' });
    intake.chooseForInterview.mockRejectedValueOnce(new InterviewError('rubric_not_approved'));
    expect(await choose()).toEqual({ ok: false, error: 'refused' });
    intake.chooseForInterview.mockRejectedValueOnce(new Error('connection lost'));
    expect(await choose()).toEqual({ ok: false, error: 'failed' });
  });

  it('a malformed request or an empty reason is refused before intake is called', async () => {
    expect(await chooseForInterview({ jobId: 'x', applicationIds: [DANIEL], reason: 'First shortlist' })).toEqual({
      ok: false,
      error: 'invalid',
    });
    expect(await chooseForInterview({ jobId: JOB, applicationIds: [], reason: 'First shortlist' })).toEqual({
      ok: false,
      error: 'invalid',
    });
    expect(await chooseForInterview({ jobId: JOB, applicationIds: [DANIEL], reason: '  ' })).toEqual({
      ok: false,
      error: 'invalid',
    });
    expect(intake.chooseForInterview).not.toHaveBeenCalled();
  });
});
