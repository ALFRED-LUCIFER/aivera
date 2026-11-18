import type { PublicJob, PublicJobLookup } from '@aivera/jobs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const findPublicJob = vi.fn<(slug: string) => Promise<PublicJobLookup>>();
vi.mock('@/server/publicJobs', () => ({ getPublicJobs: () => ({ findPublicJob }) }));

const job: PublicJob = {
  slug: 'senior-ai-engineer-3f9a1c0b2d4e',
  title: 'Senior AI Engineer',
  jobType: 'ai_llm_engineering',
  descriptor: 'A BNPL fintech',
  location: 'DIFC, Dubai',
  payBand: { minMinor: 3_500_000, maxMinor: 4_800_000, currency: 'AED' },
  competencies: [{ name: 'LLM systems in production', evidenceExpected: 'A shipped assistant', levelNeeded: 4 }],
  postedAt: new Date('2026-11-12T09:00:00.000Z'),
};

const get = async (slug: string) => {
  const { GET } = await import('./route');
  const response = await GET(new Request(`https://aivera.example/api/public/jobs/${slug}`), {
    params: Promise.resolve({ slug }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
};

beforeEach(() => findPublicJob.mockReset());

describe('GET /api/public/jobs/[slug] (AIV-P3-002)', () => {
  it('returns the open job with exactly the public fields', async () => {
    findPublicJob.mockResolvedValue({ open: true, job });
    const { status, body } = await get(job.slug);
    expect(status).toBe(200);
    expect(Object.keys(body)).toEqual([
      'slug',
      'title',
      'jobType',
      'descriptor',
      'location',
      'payBand',
      'competencies',
      'postedAt',
    ]);
    expect(body['postedAt']).toBe('2026-11-12T09:00:00.000Z');
  });

  // SAFETY: mutation check: returned found.job as is instead of toPublicJobJson -> this test failed (500, not 200 leak)
  it('a read model that ever carried a private field fails the response instead of leaking it', async () => {
    findPublicJob.mockResolvedValue({ open: true, job: { ...job, workspaceId: 'w1' } as PublicJob });
    await expect(get(job.slug)).rejects.toThrow();
  });

  it('a job taken down answers 404 no_longer_open; an unknown one 404 not_found', async () => {
    findPublicJob.mockResolvedValueOnce({ open: false }).mockResolvedValueOnce(null);
    expect(await get(job.slug)).toEqual({ status: 404, body: { error: 'no_longer_open' } });
    expect(await get('no-such-job')).toEqual({ status: 404, body: { error: 'not_found' } });
  });

  it('a malformed or over-long slug answers 404 without reading the database', async () => {
    for (const slug of ['Senior AI', '../jobs', `${'a'.repeat(101)}`, '-x']) {
      expect(await get(slug)).toEqual({ status: 404, body: { error: 'not_found' } });
    }
    expect(findPublicJob).not.toHaveBeenCalled();
  });
});
