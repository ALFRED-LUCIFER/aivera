import { AiUnavailable, BudgetExceeded, UncitedOutput } from '@aivera/ai';
import { ForbiddenError, type Role } from '@aivera/workspaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { draftCompetencies } from './draftCompetencies.ts';

// Feature: Draft competencies from the job description (AIV-P1-008), the server action. Synthetic data only.

let role: Role = 'recruiter';
const ctx = () => ({ userId: 'u1', workspaceId: 'w1', role, tx: {} });
const authorize = vi.fn(async (c: { role: Role }, action: string) => {
  if (action !== 'job.create' || (c.role !== 'admin' && c.role !== 'recruiter')) throw new ForbiddenError();
});
const draft = vi.fn();
const createJob = vi.fn();

vi.mock('@/server/workspace', () => ({
  getWorkspaces: () => ({ authorize }),
  inActiveWorkspace: async (fn: (c: ReturnType<typeof ctx>) => Promise<unknown>) => {
    try {
      return { value: await fn(ctx()) };
    } catch (error) {
      if (error instanceof ForbiddenError) throw new Error('NEXT_HTTP_ERROR_FALLBACK;403', { cause: error });
      throw error;
    }
  },
}));
vi.mock('@/server/jobs', () => ({
  getCompetencyDrafting: () => ({ draftCompetencies: draft }),
  getJobs: () => ({ createJob }),
}));
vi.mock('next/navigation', () => ({
  forbidden: () => {
    throw new Error('NEXT_HTTP_ERROR_FALLBACK;403');
  },
  unstable_rethrow: (error: unknown) => {
    if (error instanceof Error && error.message.startsWith('NEXT_')) throw error;
  },
}));

const description = 'You will build the eval sets and retrieval metrics that decide what we ship.';
const job = { jobType: 'ai_llm_engineering', title: 'Senior AI Engineer', description };
const submit = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return draftCompetencies(data);
};
const start = description.indexOf('build');

beforeEach(() => {
  vi.clearAllMocks();
  role = 'recruiter';
  draft.mockResolvedValue({
    leftOutNonSkill: false,
    competencies: [
      {
        name: 'Retrieval and evaluation',
        evidenceExpected: 'Eval sets and retrieval metrics, and how they changed decisions',
        weightPercent: 20,
        levelNeeded: 4,
        type: 'mandatory',
        origin: 'from_description',
        citations: [{ sourceId: 'description', quote: 'build the eval sets', start, end: start + 19 }],
      },
    ],
  });
});

describe('draftCompetencies (server action)', () => {
  it('drafts from the job type, title and description only, with the cited sentence, and saves nothing', async () => {
    const result = await submit({ ...job, team: 'Engineering', location: 'DIFC, Dubai' });
    expect(draft).toHaveBeenCalledWith('w1', job);
    expect(result).toEqual({
      status: 'drafted',
      competencies: [
        expect.objectContaining({
          name: 'Retrieval and evaluation',
          excerpts: [{ text: description, start, end: start + 19 }],
        }),
      ],
      leftOutNonSkill: false,
    });
    // Scenario: Nothing is saved by drafting.
    expect(createJob).not.toHaveBeenCalled();
  });

  // SAFETY: mutation check: removed the authorize(ctx, 'job.create') call -> this test failed (draft ran)
  it.each(['interviewer', 'hiring_owner'] as const)('refuses a %s with 403 and calls no model', async (r) => {
    role = r;
    await expect(submit(job)).rejects.toThrow('NEXT_HTTP_ERROR_FALLBACK;403');
    expect(draft).not.toHaveBeenCalled();
  });

  it('asks for a title before drafting', async () => {
    await expect(submit({ ...job, title: ' ' })).resolves.toEqual({ status: 'invalid', errors: { title: true } });
    expect(draft).not.toHaveBeenCalled();
  });

  it('calls no model without a description', async () => {
    await expect(submit({ ...job, description: '  ' })).resolves.toEqual({ status: 'empty' });
    expect(draft).not.toHaveBeenCalled();
  });

  it.each([
    ['the AI service fails', new AiUnavailable('jobs.draftCompetencies', 'http 500'), 'failed'],
    ['the answer is rejected twice', new UncitedOutput('jobs.draftCompetencies'), 'failed'],
    ['the daily budget is used', new BudgetExceeded('jobs.draftCompetencies', 'w1'), 'budget'],
  ])('when %s, shows a recoverable state and logs no description', async (_case, error, status) => {
    const log = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    draft.mockRejectedValueOnce(error);
    await expect(submit(job)).resolves.toEqual({ status });
    expect(log.mock.calls.join('')).not.toContain('eval sets');
    log.mockRestore();
  });
});
