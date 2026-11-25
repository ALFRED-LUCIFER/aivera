import { ForbiddenError } from '@credalent/workspaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadQuestions } from './loadQuestions.ts';
import { suggestQuestions } from './suggestQuestions.ts';

// AIV-P1-113: the server action and the page's read, with the workspace context and the modules faked; the use case
// itself is tested in modules/assessment and against PostgreSQL in tests/integration. Synthetic ids only.
const JOB = '0190d4a2-0000-7000-9000-000000001031';
const DANIEL = '0190d4a2-0000-7000-8000-00000000c002';
const ctx = { userId: 'u1', workspaceId: '0190d4a2-0000-7000-8000-000000000001', role: 'recruiter', tx: {} };
const fake = vi.hoisted(() => ({
  suggest: vi.fn(),
  stored: vi.fn(),
  rubric: vi.fn(),
  evidence: vi.fn(),
  warn: vi.fn(),
}));
vi.mock('@/server/workspace', () => ({
  inActiveWorkspace: async (fn: (c: typeof ctx) => Promise<unknown>) => {
    try {
      return { value: await fn(ctx) };
    } catch (error) {
      if (error instanceof ForbiddenError) throw new Error('NEXT_HTTP_ERROR_FALLBACK;403', { cause: error });
      throw error;
    }
  },
}));
vi.mock('@/server/assessment', () => ({
  getAssessment: () => ({ suggestInterviewQuestions: fake.suggest, getSuggestedQuestions: fake.stored }),
}));
vi.mock('@/server/jobs', () => ({ getApprovedRubricReads: () => ({ approvedRubric: fake.rubric }) }));
vi.mock('@/server/evidence', () => ({ getEvidence: () => ({ listEvidenceForCandidate: fake.evidence }) }));
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

const QUESTION = 'How was the 71% measured, on which questions, and who built that set?';
const suggested = {
  status: 'suggested',
  resultId: 'r1',
  stale: false,
  suggestedAt: new Date('2026-11-25T08:00:00.000Z'),
  gaps: [
    {
      competencyId: 'c-retrieval',
      questions: [
        {
          text: QUESTION,
          strongAnswer: 'Names the set.',
          weakAnswer: 'Repeats the figure.',
          citations: [{ itemId: 'i-cv', quote: 'from 71% to 88%' }],
        },
      ],
    },
  ],
};
const ids = { candidateId: DANIEL, jobId: JOB };

beforeEach(() => {
  vi.clearAllMocks();
  fake.rubric.mockResolvedValue({ id: 'v2', competencies: [{ id: 'c-retrieval', name: 'Retrieval and evaluation' }] });
  fake.evidence.mockResolvedValue([
    {
      id: 'i-cv',
      excerptSpan: 'page 1',
      strength: 'supporting',
      provenance: 'claim',
      source: { kind: 'cv', label: 'CV', url: null },
    },
  ]);
});

describe('suggestQuestions', () => {
  it('returns the questions with their competency name and source label', async () => {
    fake.suggest.mockResolvedValue(suggested);
    const result = await suggestQuestions(ids);
    expect(fake.suggest).toHaveBeenCalledWith(ctx, DANIEL, JOB);
    expect(result).toMatchObject({
      status: 'suggested',
      stale: false,
      gaps: [
        { name: 'Retrieval and evaluation', questions: [{ text: QUESTION, citations: [{ label: 'CV, page 1' }] }] },
      ],
    });
  });

  it.each([
    ['budget_exceeded', 'waiting'],
    ['failed', 'failed'],
    ['no_gaps', 'no_gaps'],
  ])('%s is shown as %s, with no names or evidence read', async (status, shown) => {
    fake.suggest.mockResolvedValue({ status, resultId: 'r1' });
    expect(await suggestQuestions(ids)).toEqual({ status: shown });
    expect(fake.rubric).not.toHaveBeenCalled();
    expect(fake.evidence).not.toHaveBeenCalled();
  });

  // SAFETY: mutation check: returned { status: 'failed' } for a ForbiddenError instead of rethrowing -> this test failed
  it('an interviewer without a grant on the job gets the 403 page', async () => {
    fake.suggest.mockRejectedValue(new ForbiddenError());
    await expect(suggestQuestions(ids)).rejects.toThrow('NEXT_HTTP_ERROR_FALLBACK;403');
  });

  it('a candidate the workspace does not have, or a malformed id, is not found, and nothing is asked', async () => {
    fake.suggest.mockResolvedValue(null);
    await expect(suggestQuestions(ids)).rejects.toThrow('NEXT_HTTP_ERROR_FALLBACK;404');
    fake.suggest.mockClear();
    await expect(suggestQuestions({ candidateId: 'daniel', jobId: JOB })).rejects.toThrow(
      'NEXT_HTTP_ERROR_FALLBACK;404',
    );
    expect(fake.suggest).not.toHaveBeenCalled();
  });

  it('any other error is "failed", logged by its name only', async () => {
    fake.suggest.mockRejectedValue(new TypeError(`could not read ${QUESTION}`));
    expect(await suggestQuestions(ids)).toEqual({ status: 'failed' });
    expect(fake.warn).toHaveBeenCalledWith(
      { area: 'evidence-profile', 'error.type': 'TypeError' },
      'suggest questions failed',
    );
  });
});

describe('loadQuestions', () => {
  it('reads the stored set and asks no model; nothing to show with no result or a malformed id', async () => {
    fake.stored.mockResolvedValue(suggested);
    expect(await loadQuestions(DANIEL, JOB)).toMatchObject({
      status: 'suggested',
      gaps: [{ name: 'Retrieval and evaluation' }],
    });
    fake.stored.mockResolvedValue(null);
    expect(await loadQuestions(DANIEL, JOB)).toBeNull();
    expect(await loadQuestions(DANIEL, undefined)).toBeNull();
    expect(fake.suggest).not.toHaveBeenCalled();
  });
});
