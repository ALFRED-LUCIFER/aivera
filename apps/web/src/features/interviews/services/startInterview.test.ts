import { InterviewError } from '@credalent/interviews';
import { ForbiddenError } from '@credalent/workspaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { startInterview } from './startInterview.ts';

// AIV-P1-165 §12: "Start interview". The interviews module is replaced; its roles, job scope and status moves are
// proven against PostgreSQL in tests/integration/src/interviews.test.ts.
const INTERVIEW = '0190d4a2-0000-7000-8000-0000000000e1';
const ctx = {};
const interviews = vi.hoisted(() => ({ startInterview: vi.fn() }));
vi.mock('@/server/interviews', () => ({ getInterviews: () => interviews }));
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
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT;${to}`);
  },
  unstable_rethrow: (error: unknown) => {
    if (error instanceof Error && error.message.startsWith('NEXT_')) throw error;
  },
}));

beforeEach(() => vi.clearAllMocks());

describe('the "Start interview" action', () => {
  it('starts the interview and opens its scorecard', async () => {
    await expect(startInterview(INTERVIEW)).rejects.toThrow(`NEXT_REDIRECT;/app/interviews/${INTERVIEW}`);
    expect(interviews.startInterview).toHaveBeenCalledWith(ctx, INTERVIEW);
  });

  it('an interview already started still opens its scorecard', async () => {
    interviews.startInterview.mockRejectedValueOnce(new InterviewError('status_move'));
    await expect(startInterview(INTERVIEW)).rejects.toThrow(`NEXT_REDIRECT;/app/interviews/${INTERVIEW}`);
  });

  // SAFETY: mutation check: dropped `if (error instanceof ForbiddenError) forbidden()` -> this test failed (rethrown as an error page)
  it('a member who may not hold the interview gets the 403 page, not its scorecard', async () => {
    interviews.startInterview.mockRejectedValueOnce(new ForbiddenError());
    await expect(startInterview(INTERVIEW)).rejects.toThrow('403');
  });

  it("another workspace's interview, or a malformed id, is not found", async () => {
    interviews.startInterview.mockRejectedValueOnce(new InterviewError('interview_not_found'));
    await expect(startInterview(INTERVIEW)).rejects.toThrow('404');
    await expect(startInterview('not-a-uuid')).rejects.toThrow('404');
    expect(interviews.startInterview).toHaveBeenCalledTimes(1);
  });

  it('a failure is not swallowed into an opened scorecard', async () => {
    interviews.startInterview.mockRejectedValueOnce(new Error('connection lost'));
    await expect(startInterview(INTERVIEW)).rejects.toThrow('connection lost');
  });
});
