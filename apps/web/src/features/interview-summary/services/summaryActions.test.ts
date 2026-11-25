import { InterviewError } from '@credalent/interviews';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applySummary } from './summaryActions.ts';

// AIV-P1-115: the apply action with the workspace context and the interviews module faked; the use case is tested in
// modules/interviews and against PostgreSQL in tests/integration. Synthetic ids only.
const ctx = { userId: 'u1', workspaceId: '0190d4a2-0000-7000-8000-000000000001', role: 'recruiter', tx: {} };
const INTERVIEW = '0190d4a2-0000-7000-9000-000000000060';
const SUMMARY = '0190d4a2-0000-7000-9000-000000000070';
const RETRIEVAL = '0190d4a2-0000-7000-9000-000000000040';
const fake = vi.hoisted(() => ({ apply: vi.fn(), panel: vi.fn() }));
vi.mock('@/server/workspace', () => ({
  inActiveWorkspace: async (fn: (c: typeof ctx) => Promise<unknown>) => ({ value: await fn(ctx) }),
}));
vi.mock('@/server/interviews', () => ({ getInterviews: () => ({ applySummaryProposals: fake.apply }) }));
vi.mock('./loadSummary.ts', () => ({ panelOf: fake.panel }));
vi.mock('@credalent/observability', () => ({ log: { warn: vi.fn() } }));
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

const applied = { interviewId: INTERVIEW, summary: { summaryId: SUMMARY, status: 'applied' } };
const input = {
  interviewId: INTERVIEW,
  summaryId: SUMMARY,
  previewId: 'p-1',
  changes: [{ competencyId: RETRIEVAL, reason: 'He built and graded the set himself.' }],
};

beforeEach(() => {
  vi.resetAllMocks();
  fake.panel.mockResolvedValue(applied);
});

describe('applySummary', () => {
  it('a retry after the apply committed (summary_decided) shows the stored panel, not "That did not go through"', async () => {
    fake.apply.mockRejectedValue(new InterviewError('summary_decided'));
    await expect(applySummary(input)).resolves.toEqual({ panel: applied });
  });

  it('any other refusal still says so', async () => {
    fake.apply.mockRejectedValue(new InterviewError('preview_changed'));
    await expect(applySummary(input)).resolves.toEqual({ error: 'preview_changed' });
  });
});
