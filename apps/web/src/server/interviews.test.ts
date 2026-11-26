import type { WorkspaceContext } from '@credalent/workspaces';
import { describe, expect, it, vi } from 'vitest';

// AIV-P2-006: the questions a submitted scorecard is judged on, read as the scorecard page reads them. The interviews
// composition is faked to capture what this composition root hands it; the assessment's reads are faked.
const fake = vi.hoisted(() => ({ create: vi.fn(), latest: vi.fn(), questions: vi.fn() }));
vi.mock('@credalent/interviews/composition', () => ({ createInterviews: fake.create }));
vi.mock('@credalent/intake/composition', () => ({ findApplication: vi.fn() }));
vi.mock('./assessment', () => ({
  getAssessment: () => ({ getLatestAssessment: fake.latest, getSuggestedQuestions: fake.questions }),
}));
vi.mock('./evidence', () => ({ getEvidence: vi.fn() }));
vi.mock('./jobs', () => ({ getApprovedRubricReads: () => ({ approvedRubric: vi.fn() }), getJobs: vi.fn() }));
vi.mock('./workspace', () => ({ getWorkspaces: vi.fn() }));

const { getInterviews } = await import('./interviews');

const RETRIEVAL = '0190d4a2-0000-7000-9000-000000000040';
const ctx = { workspaceId: 'w1', userId: 'u1', role: 'interviewer', tx: {} } as unknown as WorkspaceContext;
const stored = {
  status: 'suggested',
  gaps: [{ competencyId: RETRIEVAL, questions: [{ text: 'How was the 71% measured?' }] }],
};

describe('suggestedQuestions, the port the scorecard submit rebuilds its draft on', () => {
  fake.create.mockReturnValue({});
  getInterviews();
  const suggestedQuestions = fake.create.mock.calls[0]?.[5]?.suggestedQuestions as (
    ...args: [WorkspaceContext, string, string, string]
  ) => Promise<Map<string, string[]>>;
  fake.questions.mockResolvedValue(stored);

  it('gives the stored questions when the latest assessment is on the interview’s rubric version', async () => {
    fake.latest.mockResolvedValue({ rubricVersionId: 'v2' });
    expect(await suggestedQuestions(ctx, 'p1', 'j1', 'v2')).toEqual(
      new Map([[RETRIEVAL, ['How was the 71% measured?']]]),
    );
  });

  // SAFETY: mutation check: passed `true` for the version gate here -> this test failed (the questions came back).
  it('gives none when the latest assessment is on another rubric version, as the page shows none', async () => {
    fake.latest.mockResolvedValue({ rubricVersionId: 'v1' });
    expect(await suggestedQuestions(ctx, 'p1', 'j1', 'v2')).toEqual(new Map());
  });
});
