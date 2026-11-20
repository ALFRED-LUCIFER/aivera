import {
  BudgetExceeded,
  createAiClient,
  DETECT_DOMAIN_SYSTEM,
  detectDomainRequest,
  detectDomainSchema,
  fakeProvider,
  type AiProvider,
} from '@aivera/ai';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { DOMAIN_KEYS, REGIONS } from '../domain/domain-packs.ts';
import { domainDetection } from './detect-domain.ts';

// Feature: Detect the job's industry from its description (AIV-P1-063). Synthetic job text only.

const workspaceId = '0190d4a2-0000-7000-8000-000000000063';
const sentence = 'You will build the card acquiring platform that settles merchant payments across the Gulf.';
const description = `${sentence} You write tested services in TypeScript and join the on-call rota.`;
const input = {
  jobType: 'software_engineering',
  title: 'Senior Backend Engineer, Payments',
  description,
  location: 'DIFC, Dubai',
} as const;

const payments = {
  industry: { domain: 'payments_fintech', citations: [{ sourceId: 'S1', quote: sentence }] },
  regions: [{ region: 'uae', citations: [{ sourceId: 'S2', quote: 'DIFC, Dubai' }] }],
};

/** The fake model, recording every prompt it was sent; `budgetLimit` 0 means the workspace's budget is spent. */
function setup(completion: unknown, budgetLimit = 1_000_000) {
  const prompts: string[] = [];
  const fake = fakeProvider({ completion: JSON.stringify(completion) });
  const provider: AiProvider = {
    ...fake,
    languageModel: (deployment) => {
      const model = fake.languageModel(deployment) as ReturnType<typeof fake.languageModel> & {
        doGenerate: (options: { prompt: unknown }) => Promise<unknown>;
      };
      const generate = model.doGenerate.bind(model);
      model.doGenerate = (options: { prompt: unknown }) => (
        prompts.push(JSON.stringify(options.prompt)),
        generate(options)
      );
      return model;
    },
  };
  const budget = { spentToday: async () => ({ spent: 0, limit: budgetLimit }), add: async () => undefined };
  return { detection: domainDetection(createAiClient({ provider, budget })), prompts };
}

describe('Scenario: A payments description', () => {
  it('detects payments_fintech citing the sentence, and uae citing the location', async () => {
    const detected = await setup(payments).detection.detectDomain(workspaceId, input);
    expect(detected.domain).toBe('payments_fintech');
    const [citation] = detected.citations;
    expect(citation?.sourceId).toBe('description');
    expect(description.slice(citation?.start, citation?.end)).toBe(sentence);
    expect(detected.regions).toEqual([
      { region: 'uae', citations: [{ sourceId: 'location', quote: 'DIFC, Dubai', start: 0, end: 11 }] },
    ]);
  });
});

describe('Scenario: No clear domain', () => {
  it('returns none with no citation, so no pack is suggested', async () => {
    const plain = { ...input, description: 'You write tested services in TypeScript and join the on-call rota.' };
    const detected = await setup({ industry: { domain: 'none' }, regions: [] }).detection.detectDomain(
      workspaceId,
      plain,
    );
    expect(detected).toEqual({ domain: 'none', citations: [], regions: [] });
  });
});

describe('Scenario: Invented domains and citations are rejected', () => {
  it('rejects a domain not in the catalogue, retries once, then returns none', async () => {
    const invented = { ...payments, industry: { ...payments.industry, domain: 'crypto_gaming' } };
    const { detection, prompts } = setup(invented);
    expect(await detection.detectDomain(workspaceId, input)).toEqual({ domain: 'none', citations: [], regions: [] });
    expect(prompts).toHaveLength(2);
  });

  // SAFETY: mutation check: quote check skipped in checkOutput (packages/ai citations.ts) -> this test failed (payments_fintech returned)
  it('rejects a citation that is not in the description, retries once, then returns none', async () => {
    const quote = 'We are the largest payments company in the Gulf.';
    const invented = { ...payments, industry: { ...payments.industry, citations: [{ sourceId: 'S1', quote }] } };
    const { detection, prompts } = setup(invented);
    expect(await detection.detectDomain(workspaceId, input)).toEqual({ domain: 'none', citations: [], regions: [] });
    expect(prompts).toHaveLength(2);
  });

  it('rejects a region named twice or not in the catalogue, rather than patching it', () => {
    const schema = detectDomainSchema({ domains: DOMAIN_KEYS, regions: REGIONS });
    const uae = payments.regions[0];
    expect(schema.safeParse(payments).success).toBe(true);
    expect(schema.safeParse({ ...payments, regions: [uae, uae] }).success).toBe(false);
    expect(schema.safeParse({ ...payments, regions: [{ ...uae, region: 'qatar' }] }).success).toBe(false);
    // A named domain must cite; `none` needs no citation.
    expect(schema.safeParse({ ...payments, industry: { domain: 'payments_fintech', citations: [] } }).success).toBe(
      false,
    );
  });

  it('still throws when the budget is spent: an outage is not a "none"', async () => {
    await expect(setup(payments, 0).detection.detectDomain(workspaceId, input)).rejects.toBeInstanceOf(BudgetExceeded);
  });
});

describe('Scenario: Protected traits in a description are not turned into anything', () => {
  it('returns only a domain, its citations and regions, whatever else the model adds', async () => {
    const traits = `${sentence} UAE nationals preferred. Candidates must have worked at a big bank.`;
    const answer = { ...payments, nationality: 'UAE', employer: 'a big bank', reason: 'UAE nationals preferred' };
    const detected = await setup(answer).detection.detectDomain(workspaceId, { ...input, description: traits });
    expect(Object.keys(detected).toSorted()).toEqual(['citations', 'domain', 'regions']);
    const regionQuotes = detected.regions.flatMap((r) => r.citations.map((c) => c.quote));
    expect(regionQuotes).toEqual(['DIFC, Dubai']);
    expect(JSON.stringify(detected)).not.toMatch(/nationals|big bank/);
  });
});

describe('Scenario: No candidate data reaches the prompt', () => {
  it('sends only the job type, title, description and location, besides the fixed instructions', async () => {
    const { detection, prompts } = setup(payments);
    await detection.detectDomain(workspaceId, input);
    const messages = JSON.parse(prompts[0] ?? '[]') as { role: string; content: string | { text: string }[] }[];
    const text = (m: (typeof messages)[number]) =>
      typeof m.content === 'string' ? m.content : m.content.map((p) => p.text).join('');
    const system = messages.find((m) => m.role === 'system');
    expect(system && text(system)).toContain(DETECT_DOMAIN_SYSTEM);
    // The citation rules and the numbered source wrapper are the AI package's; what varies is exactly our four fields.
    expect(
      messages
        .filter((m) => m.role === 'user')
        .map(text)
        .join(''),
    ).toBe(
      'Job type: software_engineering\nTitle: Senior Backend Engineer, Payments\n\nSources:\n' +
        `<source id="S1" kind="job_description">\n${description}\n</source>\n` +
        '<source id="S2" kind="job_description">\nDIFC, Dubai\n</source>',
    );
  });

  it('leaves out an empty location rather than sending a blank source', async () => {
    const { detection, prompts } = setup({ industry: { domain: 'none' }, regions: [] });
    await detection.detectDomain(workspaceId, { ...input, location: null });
    expect(prompts[0]).not.toContain('S2');
  });
});

describe('Scenario: Only the published version is read (AIV-P2-044)', () => {
  it('sends the request built from the code catalogue: the same prompt and output schema', () => {
    const { schema, ...request } = detectDomainRequest(input, { domains: DOMAIN_KEYS, regions: REGIONS }, []);
    expect({ ...request, schema: z.toJSONSchema(schema, { unrepresentable: 'any' }) }).toMatchSnapshot();
  });
});
