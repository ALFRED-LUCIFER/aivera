import { AiUnavailable, BudgetExceeded, SchemaMismatch, UncitedOutput } from '@credalent/ai';
import { ForbiddenError, type Role } from '@credalent/workspaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { draftCompetencies } from './draftCompetencies.ts';

// Feature: Draft competencies from the job description (AIV-P1-008), the server action. Synthetic data only.

let role: Role = 'recruiter';
const ctx = () => ({ userId: 'u1', workspaceId: 'w1', role, tx: {} });
const authorize = vi.fn(async (c: { role: Role }, action: string) => {
  if (action !== 'job.create' || (c.role !== 'admin' && c.role !== 'recruiter')) throw new ForbiddenError();
});
const draft = vi.fn();
const detect = vi.fn();
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
  getDomainDetection: () => ({ detectDomain: detect }),
  getJobs: () => ({ createJob }),
  getCatalogue: () => ({
    getPublishedCatalogue: async () => (await import('@/test/catalogue-v1.ts')).CATALOGUE_V1,
  }),
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
  detect.mockResolvedValue({ domain: 'none', citations: [], regions: [] });
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
    suggestions: [
      {
        name: 'Product judgement',
        evidenceExpected: 'Product decisions they shaped from evals or merchant feedback',
        weightPercent: 15,
        levelNeeded: 3,
        type: 'desirable',
        origin: 'suggested_by_aivera',
        why: 'Your evals decide what ships, but the description does not ask for judging what merchants need.',
        citations: [{ sourceId: 'description', quote: 'decide what we ship', start: start + 47, end: start + 66 }],
      },
    ],
  });
});

describe('draftCompetencies (server action)', () => {
  it('drafts from the job type, title and description only, with the cited sentence, and saves nothing', async () => {
    const result = await submit({ ...job, team: 'Engineering', location: 'DIFC, Dubai' });
    expect(draft).toHaveBeenCalledWith('w1', job, expect.objectContaining({ version: 1 }));
    expect(result).toEqual({
      status: 'drafted',
      competencies: [
        expect.objectContaining({
          name: 'Retrieval and evaluation',
          origin: 'from_description',
          excerpts: [{ text: description, start, end: start + 19 }],
        }),
        // The suggestions follow the drafted competencies, each with its why and its cited sentence (AIV-P1-009).
        expect.objectContaining({
          name: 'Product judgement',
          origin: 'suggested_by_aivera',
          why: 'Your evals decide what ships, but the description does not ask for judging what merchants need.',
          excerpts: [{ text: description, start: start + 47, end: start + 66 }],
        }),
      ],
      leftOutNonSkill: false,
      jobType: 'ai_llm_engineering',
      industry: null,
      regions: [],
    });
    expect(detect).toHaveBeenCalledWith(
      'w1',
      { ...job, location: 'DIFC, Dubai' },
      expect.objectContaining({ version: 1 }),
    );
    // Scenario: Nothing is saved by drafting.
    expect(createJob).not.toHaveBeenCalled();
  });

  // SAFETY: mutation check: removed the authorize(ctx, 'job.create') call -> this test failed (draft ran)
  it.each(['interviewer', 'hiring_owner'] as const)('refuses a %s with 403 and calls no model', async (r) => {
    role = r;
    await expect(submit(job)).rejects.toThrow('NEXT_HTTP_ERROR_FALLBACK;403');
    expect(draft).not.toHaveBeenCalled();
    expect(detect).not.toHaveBeenCalled();
  });

  // Feature: Suggest an industry's competencies (AIV-P1-064): the detected industry, its cited sentence and regions.
  it('returns the detected industry with its cited sentence and the regions', async () => {
    const at = description.indexOf('decide what we ship');
    detect.mockResolvedValueOnce({
      domain: 'payments_fintech',
      citations: [{ sourceId: 'description', quote: 'decide what we ship', start: at, end: at + 19 }],
      regions: [{ region: 'uae', citations: [{ sourceId: 'location', quote: 'Dubai', start: 6, end: 11 }] }],
    });
    await expect(submit({ ...job, location: 'DIFC, Dubai' })).resolves.toMatchObject({
      status: 'drafted',
      industry: { key: 'payments_fintech', excerpts: [{ text: description, start: at, end: at + 19 }] },
      regions: ['uae'],
    });
  });

  it.each([
    ['the AI service fails', new AiUnavailable('jobs.detectDomain', 'http 500')],
    ['the daily budget is used', new BudgetExceeded('jobs.detectDomain', 'w1')],
  ])('when detecting the industry %s, the draft still shows, with no industry', async (_case, error) => {
    const log = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    detect.mockRejectedValueOnce(error);
    await expect(submit(job)).resolves.toMatchObject({ status: 'drafted', industry: null, regions: [] });
    expect(log.mock.calls.join('')).not.toContain('eval sets');
    log.mockRestore();
  });

  it('a detection bug is not hidden as "no industry"', async () => {
    detect.mockRejectedValueOnce(new TypeError('bug'));
    await expect(submit(job)).resolves.toEqual({ status: 'failed' });
  });

  it('asks for a title before drafting', async () => {
    await expect(submit({ ...job, title: ' ' })).resolves.toEqual({ status: 'invalid', errors: { title: true } });
    expect(draft).not.toHaveBeenCalled();
    expect(detect).not.toHaveBeenCalled();
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

  // AIV-P1-082 scenario 3: the failure log names the rule, never content.
  // SAFETY: mutation check: dropped the credalent.ai.schema_rules field from the "draft failed" line -> this test failed
  it('a rejected answer logs which schema rule it broke on "draft failed", and never the description', async () => {
    const log = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    draft.mockRejectedValueOnce(new SchemaMismatch('jobs.draftCompetencies', [':custom']));
    await expect(submit(job)).resolves.toEqual({ status: 'failed' });
    const written = log.mock.calls.join('');
    expect(written).toContain('"credalent.ai.schema_rules":":custom"');
    expect(written).toContain('draft failed');
    expect(written).not.toContain('eval sets');
    log.mockRestore();
  });
});
