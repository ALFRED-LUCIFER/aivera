import { context, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { MockLanguageModelV4 } from 'ai/test';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { cited, findQuote, InvalidCitation, SchemaMismatch, UncitedOutput, type Source } from './citations';
import { createAiClient, memoryTokenBudget } from './client';
import { fakeProvider, type AiProvider } from './providers';

// Schemas use .nullable(), never .optional(): Azure's strict structured outputs require every property.
// Feature: Structured output with required citations (AIV-P0-028). Synthetic data only (docs/00-product/personas.md).

const spans = new InMemorySpanExporter();
beforeAll(() => {
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  trace.setGlobalTracerProvider(new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(spans)] }));
});
afterAll(() => {
  trace.disable();
  context.disable();
});
beforeEach(() => spans.reset());

const workspaceId = '0190d4a2-0000-7000-8000-000000000001';

const S1: Source = {
  id: '0190d4a2-0000-7000-8000-0000000000e1',
  kind: 'repo',
  text: 'llm-eval-harness, main branch: Sara Al Qahtani authored 412 of\n   460 commits between March and October.',
};
const S2: Source = {
  id: '0190d4a2-0000-7000-8000-0000000000e2',
  kind: 'cv',
  text: 'CV page 2. Merchant assistant: cut cost per request by 40% after moving retrieval to a smaller model.',
};
const S3: Source = {
  id: '0190d4a2-0000-7000-8000-0000000000e3',
  kind: 'job_description',
  text: 'Senior AI Engineer. You will reduce inference cost across our assistants.',
};
const sources = [S1, S2, S3];
const candidateText = /sara|qahtani|412|460|cost per request|merchant|twenty/i;

const schema = z.object({
  strengths: z.array(cited(z.object({ statement: z.string(), weight: z.number(), claim: z.boolean().nullable() }))),
});

/** A provider whose model gives these answers in turn, recording the prompt of each request. */
function answers(...outputs: unknown[]) {
  const prompts: string[] = [];
  const provider: AiProvider = {
    ...fakeProvider(),
    languageModel: () =>
      new MockLanguageModelV4({
        doGenerate: async ({ prompt }) => {
          prompts.push(JSON.stringify(prompt));
          const next = outputs.shift();
          const text = typeof next === 'string' ? next : JSON.stringify(next);
          return {
            content: [{ type: 'text', text }],
            finishReason: { unified: 'stop', raw: 'stop' },
            usage: {
              inputTokens: { total: 100, noCache: undefined, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: 20, text: 20, reasoning: 0 },
            },
            warnings: [],
          };
        },
      }),
  };
  const budget = memoryTokenBudget();
  const ai = createAiClient({ provider, budget, now: () => Date.parse('2026-11-18T09:00:00Z') });
  const run = (overrides: { promptVersion?: string; catalogueVersion?: number } = {}) =>
    ai.generateStructured({
      task: 'jobs.draftCompetencies',
      workspaceId,
      promptVersion: 'test.strengths@1',
      system: 'List the strengths the sources show.',
      prompt: 'Strengths for a Senior AI Engineer.',
      schema,
      sources,
      ...overrides,
    });
  return { run, prompts, budget };
}

const statement = (citations: unknown, extra = {}) => ({
  strengths: [{ statement: 'Owns the eval harness', weight: 25, claim: null, citations, ...extra }],
});
const harness = { sourceId: 'S1', quote: 'authored 412 of 460 commits' };
const structuredSpan = () => spans.getFinishedSpans().findLast((span) => span.name.startsWith('ai structured'));

describe('Scenario: A cited answer passes and gets offsets', () => {
  it('validates, maps S1 back to its evidence id, and gives offsets in the original text', async () => {
    const { run, prompts } = answers(statement([harness]));
    const output = await run();

    const [strength] = output.strengths;
    const start = S1.text.indexOf('authored');
    const end = S1.text.indexOf(' between');
    expect(strength?.citations).toEqual([
      { sourceId: S1.id, quote: S1.text.slice(start, end), start, end }, // the source's own whitespace
    ]);
    expect(strength?.claim).toBe(false);
    expect(prompts).toHaveLength(1);
    // The model sees numbered sources, never the evidence ids.
    expect(prompts[0]).toContain('<source id=\\"S1\\" kind=\\"repo\\">');
    expect(prompts[0]).not.toContain(S1.id);
    expect(structuredSpan()?.attributes).toMatchObject({
      'aivera.ai.outcome': 'ok',
      'aivera.ai.attempts': 1,
      'aivera.ai.template_version': 'test.strengths@1+citations@1',
    });
  });

  it('AIV-P2-044: records the catalogue version next to the prompt version', async () => {
    await answers(statement([harness])).run({ catalogueVersion: 3 });
    expect(structuredSpan()?.attributes['aivera.ai.template_version']).toBe('test.strengths@1+citations@1+catalogue@3');
  });

  it('matches a quote with collapsed whitespace, and never an empty quote', () => {
    expect(findQuote('a  b\n\tc', ' a b c ')).toEqual({ start: 0, end: 7 });
    expect(findQuote('  lead  text', 'lead text')).toEqual({ start: 2, end: 12 });
    expect(findQuote('abc', '   ')).toBeUndefined();
    expect(findQuote('abc', 'ABC')).toBeUndefined();
  });
});

describe('Scenario: An uncited statement is rejected', () => {
  // SAFETY: mutation check: removed .min(1) from cited() -> this test failed (the uncited answer resolved)
  it('retries once, then fails with UncitedOutput; both attempts are charged and nothing is returned', async () => {
    const { run, prompts, budget } = answers(statement([]), statement(undefined));
    await expect(run()).rejects.toBeInstanceOf(UncitedOutput);
    expect(prompts).toHaveLength(2);
    expect(await budget.spentToday(workspaceId, '2026-11-18')).toEqual({ spent: 240, limit: 2_000_000 });
    expect(structuredSpan()?.attributes).toMatchObject({
      'aivera.ai.outcome': 'rejected',
      'aivera.ai.attempts': 2,
      'error.type': 'UncitedOutput',
    });
  });

  it('a cited retry succeeds', async () => {
    const { run, prompts } = answers(statement([]), statement([harness]));
    await expect(run()).resolves.toMatchObject({ strengths: [{ citations: [{ sourceId: S1.id }] }] });
    expect(prompts).toHaveLength(2);
  });
});

describe('Scenario: A citation to an unknown source is rejected', () => {
  // SAFETY: mutation check: returned the citation unchecked instead of throwing for an unknown source -> this test failed
  it('fails with InvalidCitation naming S9', async () => {
    const unknown = statement([{ sourceId: 'S9', quote: 'authored 412 of 460 commits' }]);
    const { run, prompts } = answers(unknown, unknown);
    const error = await run().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InvalidCitation);
    expect((error as Error).message).toMatch(/\bS9\b/);
    expect(prompts).toHaveLength(2);
  });

  // SAFETY: mutation check: named the label in the message unconditionally -> this test failed
  it('an invented label that is not shaped like S1 is not echoed into the error', async () => {
    const invented = statement([{ sourceId: 'Sara Al Qahtani CV', quote: 'x' }]);
    const error = await answers(invented, invented)
      .run()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InvalidCitation);
    expect(String((error as Error).stack)).not.toMatch(candidateText);
  });
});

describe('Scenario: A quote that is not in the source is rejected', () => {
  // SAFETY: mutation check: made findQuote return { start: 0, end: 0 } for any quote -> this test failed
  it('fails with InvalidCitation and does not echo the quote', async () => {
    const invented = statement([{ sourceId: 'S1', quote: 'authored all 460 commits' }]);
    const error = await answers(invented, invented)
      .run()
      .catch((e: unknown) => e);
    expect(error).toEqual(new InvalidCitation('jobs.draftCompetencies', 'S1', 'quote not in source'));
    expect(String((error as Error).stack)).not.toMatch(candidateText);
  });
});

describe("Scenario: Statements resting only on the candidate's word are claims", () => {
  // SAFETY: mutation check: spread the model's fields after `claim` in checkOutput -> this test failed (claim stayed false)
  // SAFETY: mutation check: dropped the BACKS_NOTHING check (any non-CV source backs) -> this test failed (CV + job description)
  it('a statement citing only the CV, or the CV and the job description, is a claim whatever the model says', async () => {
    const cost = { sourceId: 'S2', quote: 'cut cost per request by 40%' };
    const need = { sourceId: 'S3', quote: 'reduce inference cost' };
    const { run } = answers({
      strengths: [
        { statement: 'Cut cost per request', weight: 15, claim: false, citations: [cost] },
        { statement: 'Cut cost as the job needs', weight: 15, claim: false, citations: [cost, need] },
        { statement: 'Owns the eval harness', weight: 25, claim: true, citations: [harness, cost] },
        { statement: 'The job needs lower cost', weight: 5, claim: true, citations: [need] },
      ],
    });
    const output = await run();
    expect(output.strengths.map((s) => s.claim)).toEqual([true, true, false, false]);
  });
});

describe('Scenario: Schema mismatch', () => {
  const twenty = statement([harness], { weight: 'twenty' });
  // SAFETY: mutation check: put `text` into either SchemaMismatch message in checkOutput -> the matching case failed
  // SAFETY: mutation check: annotateSpan({ "aivera.ai.output": text }) before checkOutput -> both cases failed
  it.each([
    ['a weight of "twenty"', twenty],
    ['output that is not JSON', 'weight: twenty'],
  ])('%s fails with SchemaMismatch after one retry, and the raw output is not kept anywhere', async (_, output) => {
    const { run, prompts } = answers(output, output);
    const error = await run().catch((e: unknown) => e);
    expect(error).toEqual(new SchemaMismatch('jobs.draftCompetencies'));
    expect((error as Error).cause).toBeUndefined();
    expect(prompts).toHaveLength(2);
    expect(String((error as Error).stack)).not.toMatch(candidateText);
    const telemetry = spans
      .getFinishedSpans()
      .map((s) => ({ name: s.name, attributes: s.attributes, events: s.events }));
    expect(JSON.stringify(telemetry)).not.toMatch(candidateText);
    expect(structuredSpan()?.attributes).toMatchObject({ 'error.type': 'SchemaMismatch' });
  });
});

describe('Prompt versions', () => {
  it('a prompt version that is not an id@version is refused before any model call', async () => {
    const { run, prompts } = answers(statement([harness]));
    await expect(run({ promptVersion: 'Sara Al Qahtani' })).rejects.toThrow(/promptVersion must look like/);
    expect(prompts).toHaveLength(0);
  });
});
