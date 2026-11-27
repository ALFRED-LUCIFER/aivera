import { InterviewError } from '@credalent/interviews';
import { ForbiddenError } from '@credalent/workspaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { scheduleInterview } from './scheduleInterview.ts';

// AIV-P2-007: the action the Schedule dialog posts. The interviews module is replaced; its rules and role checks are
// proven against PostgreSQL in tests/integration/src/interviews.test.ts.
const INTERVIEW = '0190d4a2-0000-7000-9000-000000000060';
const LINA = '0190d4a2-0000-7000-8000-0000000011aa';
const interviews = { scheduleInterview: vi.fn() };
vi.mock('@/server/interviews', () => ({ getInterviews: () => interviews }));
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

const input = (over: Record<string, unknown> = {}) => ({
  interviewId: INTERVIEW,
  scheduledAt: '2026-11-21T07:00:00.000Z',
  interviewerUserId: LINA,
  keepClash: false,
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe('the schedule action', () => {
  it('passes the instant as a Date and says it is scheduled', async () => {
    interviews.scheduleInterview.mockResolvedValueOnce({ status: 'scheduled' });
    expect(await scheduleInterview(input())).toEqual({ ok: true });
    expect(interviews.scheduleInterview).toHaveBeenCalledWith(
      {},
      {
        interviewId: INTERVIEW,
        interviewerUserId: LINA,
        keepClash: false,
        scheduledAt: new Date('2026-11-21T07:00:00.000Z'),
      },
    );
  });

  it('returns the clash time, and maps the module refusals to the dialog messages', async () => {
    interviews.scheduleInterview.mockResolvedValueOnce({
      status: 'clash',
      clashAt: new Date('2026-11-21T07:30:00.000Z'),
    });
    expect(await scheduleInterview(input())).toEqual({
      ok: false,
      error: 'clash',
      clashAt: '2026-11-21T07:30:00.000Z',
    });
    interviews.scheduleInterview.mockRejectedValueOnce(new InterviewError('time_in_past'));
    expect(await scheduleInterview(input())).toEqual({ ok: false, error: 'pastTime' });
    interviews.scheduleInterview.mockRejectedValueOnce(new InterviewError('interviewer_not_on_job'));
    expect(await scheduleInterview(input())).toEqual({ ok: false, error: 'notOnJob' });
  });

  it('asks for an interviewer when none is posted, without calling the module', async () => {
    expect(await scheduleInterview(input({ interviewerUserId: '' }))).toEqual({ ok: false, error: 'noInterviewer' });
    expect(interviews.scheduleInterview).not.toHaveBeenCalled();
  });

  it('a role without interview.schedule gets the 403 page', async () => {
    interviews.scheduleInterview.mockRejectedValueOnce(new ForbiddenError());
    await expect(scheduleInterview(input())).rejects.toThrow('403');
  });
});
