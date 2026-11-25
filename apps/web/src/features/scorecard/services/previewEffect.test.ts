import { InterviewError } from '@credalent/interviews';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { previewScorecardRatings } from './previewEffect.ts';

// AIV-P2-005: the preview action with the workspace context and the interviews contract faked. Who may preview and
// that it writes nothing are proven in modules/interviews/src/application/summary.test.ts; the assessment's preview in
// modules/assessment and tests/integration/src/score-change.test.ts. Synthetic ids only.
const ctx = { userId: 'u1', workspaceId: '0190d4a2-0000-7000-8000-000000000001', role: 'interviewer', tx: {} };
const INTERVIEW = '0190d4a2-0000-7000-9000-000000000060';
const RETRIEVAL = '0190d4a2-0000-7000-9000-000000000040';
const fake = vi.hoisted(() => ({ preview: vi.fn(), warn: vi.fn() }));
vi.mock('@/server/workspace', () => ({
  inActiveWorkspace: async (fn: (c: typeof ctx) => Promise<unknown>) => ({ value: await fn(ctx) }),
}));
// The contract fake has the preview and nothing else.
vi.mock('@/server/interviews', () => ({ getInterviews: () => ({ previewScorecardRatings: fake.preview }) }));
vi.mock('@credalent/observability', () => ({ log: { warn: fake.warn } }));
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

const ratings = [{ competencyId: RETRIEVAL, rating: 'strongly_shown' }];
const states = { from: { strength: 'supporting', provenLevel: 0 }, to: { strength: 'medium', provenLevel: 3 } };

beforeEach(() => {
  vi.resetAllMocks();
  fake.preview.mockResolvedValue({
    previewId: 'p-1',
    backedScore: { from: 55, to: 67 },
    changes: [{ competencyId: RETRIEVAL, ...states, replaces: null }],
  });
});

describe('previewScorecardRatings', () => {
  it('passes the ratings to the interviews contract and returns what the panel shows, no preview id', async () => {
    await expect(previewScorecardRatings({ interviewId: INTERVIEW, ratings })).resolves.toEqual({
      backedScore: { from: 55, to: 67 },
      changes: [{ competencyId: RETRIEVAL, ...states }],
    });
    expect(fake.preview).toHaveBeenCalledWith(ctx, INTERVIEW, ratings);
  });

  it('an expected refusal is unavailable and not logged; anything else is unavailable and logged by name', async () => {
    fake.preview.mockRejectedValueOnce(new InterviewError('not_assessed'));
    await expect(previewScorecardRatings({ interviewId: INTERVIEW, ratings })).resolves.toBeNull();
    expect(fake.warn).not.toHaveBeenCalled();
    fake.preview.mockRejectedValueOnce(new TypeError('connection reset'));
    await expect(previewScorecardRatings({ interviewId: INTERVIEW, ratings })).resolves.toBeNull();
    expect(fake.warn).toHaveBeenCalledWith(
      { area: 'scorecard', 'error.type': 'TypeError' },
      'preview scorecard ratings failed',
    );
  });

  it('a malformed input or an interview the workspace does not have is not found', async () => {
    await expect(previewScorecardRatings({ interviewId: INTERVIEW, ratings: [] })).rejects.toThrow('404');
    // Two ratings of one competency are invalid here, by the interviews module's own schema, not an unexpected error.
    const twice = [...ratings, { competencyId: RETRIEVAL, rating: 'not_shown' }];
    await expect(previewScorecardRatings({ interviewId: INTERVIEW, ratings: twice })).rejects.toThrow('404');
    expect(fake.preview).not.toHaveBeenCalled();
    expect(fake.warn).not.toHaveBeenCalled();
    fake.preview.mockRejectedValueOnce(new InterviewError('interview_not_found'));
    await expect(previewScorecardRatings({ interviewId: INTERVIEW, ratings })).rejects.toThrow('404');
  });
});
