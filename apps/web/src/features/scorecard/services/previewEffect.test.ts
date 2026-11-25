import { beforeEach, describe, expect, it, vi } from 'vitest';
import { previewScorecardRatings } from './previewEffect.ts';

// AIV-P2-005: the preview action with the workspace context and both contracts faked; the preview itself is tested in
// modules/assessment and against PostgreSQL in tests/integration/src/score-change.test.ts. Synthetic ids only.
const ctx = { userId: 'u1', workspaceId: '0190d4a2-0000-7000-8000-000000000001', role: 'recruiter', tx: {} };
const INTERVIEW = '0190d4a2-0000-7000-9000-000000000060';
const SNAPSHOT = '0190d4a2-0000-7000-9000-000000000080';
const RETRIEVAL = '0190d4a2-0000-7000-9000-000000000040';
const fake = vi.hoisted(() => ({ interview: vi.fn(), latest: vi.fn(), preview: vi.fn() }));
vi.mock('@/server/workspace', () => ({
  inActiveWorkspace: async (fn: (c: typeof ctx) => Promise<unknown>) => ({ value: await fn(ctx) }),
}));
// SAFETY: each contract fake has its reads and nothing else: any write (applyScoreChange, assessCandidate,
// saveScorecardDraft, ...) throws here, so the preview comes back unavailable and the first test fails.
vi.mock('@/server/interviews', () => ({ getInterviews: () => ({ getInterview: fake.interview }) }));
vi.mock('@/server/assessment', () => ({
  getAssessment: () => ({ getLatestAssessment: fake.latest, previewScoreChange: fake.preview }),
}));
vi.mock('@credalent/observability', () => ({ log: { warn: vi.fn() } }));
vi.mock('next/navigation', () => ({
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
  fake.interview.mockResolvedValue({ id: INTERVIEW, candidateId: 'p-daniel', jobId: 'j-ai' });
  fake.latest.mockResolvedValue({ id: SNAPSHOT });
  fake.preview.mockResolvedValue({
    previewId: 'p-1',
    assessmentId: SNAPSHOT,
    label: 'interviewer_word',
    backedScore: { from: 55, to: 67 },
    upperBound: { from: 71, to: 71 },
    changes: [{ competencyId: RETRIEVAL, rating: 'strongly_shown', ...states, noChange: null, replaces: null }],
  });
});

describe('Scenario: Preview applies nothing', () => {
  // SAFETY: mutation check: called getAssessment().applyScoreChange after the preview -> this test failed (null, not the effect)
  it("previews the latest snapshot through the assessment's reads only, and returns what the panel shows", async () => {
    await expect(previewScorecardRatings({ interviewId: INTERVIEW, ratings })).resolves.toEqual({
      backedScore: { from: 55, to: 67 },
      changes: [{ competencyId: RETRIEVAL, ...states }],
    });
    expect(fake.latest).toHaveBeenCalledWith(ctx, 'p-daniel', 'j-ai');
    expect(fake.preview).toHaveBeenCalledWith(ctx, {
      assessmentId: SNAPSHOT,
      interviewId: INTERVIEW,
      changes: ratings,
    });
  });
});

describe('Scenario: Preview service fails', () => {
  it('is unavailable, not an error page, when the assessment refuses or fails', async () => {
    fake.preview.mockRejectedValue(new Error('not_yet_scored'));
    await expect(previewScorecardRatings({ interviewId: INTERVIEW, ratings })).resolves.toBeNull();
  });

  it('is unavailable with no assessment yet, or an interview the member cannot see, and previews nothing', async () => {
    fake.latest.mockResolvedValue(null);
    await expect(previewScorecardRatings({ interviewId: INTERVIEW, ratings })).resolves.toBeNull();
    fake.interview.mockResolvedValue(null);
    await expect(previewScorecardRatings({ interviewId: INTERVIEW, ratings })).resolves.toBeNull();
    expect(fake.preview).not.toHaveBeenCalled();
  });

  it('a malformed input is not found', async () => {
    await expect(previewScorecardRatings({ interviewId: INTERVIEW, ratings: [] })).rejects.toThrow('404');
    expect(fake.interview).not.toHaveBeenCalled();
  });
});
