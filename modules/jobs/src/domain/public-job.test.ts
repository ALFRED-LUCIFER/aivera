import { describe, expect, it } from 'vitest';
import { publicJobJson, slugFor, toPublicJobJson, type PublicJob } from './public-job.ts';

const job: PublicJob = {
  slug: 'senior-ai-engineer-3f9a1c',
  title: 'Senior AI Engineer',
  jobType: 'ai_llm_engineering',
  descriptor: 'A BNPL fintech',
  location: 'DIFC, Dubai',
  payBand: { minMinor: 3_500_000, maxMinor: 4_800_000, currency: 'AED' },
  competencies: [{ name: 'LLM systems in production', evidenceExpected: 'A shipped assistant', levelNeeded: 4 }],
  postedAt: new Date('2026-11-12T09:00:00.000Z'),
};

describe('slugFor', () => {
  it('makes a lowercase, hyphenated address with the random tail', () => {
    expect(slugFor('Senior Product Manager, Payments', '3f9a1c')).toBe('senior-product-manager-payments-3f9a1c');
    expect(slugFor('  Ingénieur QA / Test  ', 'a1b2c3')).toBe('ingenieur-qa-test-a1b2c3');
    expect(slugFor('مهندس', 'a1b2c3')).toBe('a1b2c3');
  });
});

describe('the public contract (publicJobJson)', () => {
  it('has exactly the public fields, and competencies exactly name, evidence expected and level', () => {
    expect(Object.keys(publicJobJson.shape)).toEqual([
      'slug',
      'title',
      'jobType',
      'descriptor',
      'location',
      'payBand',
      'competencies',
      'postedAt',
    ]);
    expect(Object.keys(publicJobJson.shape.competencies.element.shape)).toEqual([
      'name',
      'evidenceExpected',
      'levelNeeded',
    ]);
  });

  // SAFETY: mutation check: z.strictObject -> z.object in publicJobJson -> this test failed (weight passed through)
  it('refuses a response carrying a weight, a client name or a workspace id', () => {
    const json = toPublicJobJson(job);
    expect(json.postedAt).toBe('2026-11-12T09:00:00.000Z');
    expect(publicJobJson.safeParse({ ...json, clientName: 'Falcon Pay' }).success).toBe(false);
    expect(publicJobJson.safeParse({ ...json, workspaceId: 'w1' }).success).toBe(false);
    const weighted = { ...json, competencies: [{ ...job.competencies[0], weightPercent: 25 }] };
    expect(publicJobJson.safeParse(weighted).success).toBe(false);
  });
});
