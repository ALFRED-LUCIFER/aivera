import { context, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { APICallError } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { z } from 'zod';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AiUnavailable,
  BudgetExceeded,
  createAiClient,
  memoryTokenBudget,
  UnknownAiTask,
  type TokenBudgetStore,
} from './client';
import { maxAttempts } from './config';
import { azureProvider, fakeProvider, providerFromEnv, type AiProvider } from './providers';

// Feature: One AI client on Azure AI Foundry (AIV-P0-027). Synthetic data only (docs/00-product/personas.md).

// Raw spans, before packages/observability redacts them: the client itself must never put a prompt on one.
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
// The last model call's span; generateStructured's own span around its calls is checked in citations.test.ts.
const lastSpan = () => spans.getFinishedSpans().findLast((span) => !span.name.startsWith('ai structured'));

/** The fake provider, counting the deployments each attempt asked for. */
function counted(provider: AiProvider) {
  const calls: string[] = [];
  return {
    calls,
    provider: {
      languageModel: (deployment: string) => (calls.push(deployment), provider.languageModel(deployment)),
      embeddingModel: (deployment: string) => (calls.push(deployment), provider.embeddingModel(deployment)),
    },
  };
}

function setup(provider = fake(), start = Date.parse('2026-11-18T09:00:00Z'), budget = memoryTokenBudget()) {
  const clock = { now: start };
  const sleeps: number[] = [];
  const spy = counted(provider);
  const ai = createAiClient({
    provider: spy.provider,
    budget,
    now: () => clock.now,
    sleep: async (ms) => void sleeps.push(ms),
  });
  return { ai, clock, sleeps, calls: spy.calls };
}

const READY = JSON.stringify({ ready: true });
/** The fake provider answering with output that matches the draft's schema. */
const fake = (options: Parameters<typeof fakeProvider>[0] = {}) => fakeProvider({ completion: READY, ...options });

const draft = {
  task: 'jobs.draftCompetencies',
  workspaceId,
  promptVersion: 'test.ready@1',
  system: 'You check readiness.',
  prompt: 'Draft competencies for a data engineer.',
  schema: z.object({ ready: z.boolean() }),
  sources: [],
} as const;

describe('Scenario: A task resolves to its configured deployment', () => {
  it('sends jobs.draftCompetencies to gpt-main with a managed-identity token and no API key', async () => {
    const requests: Request[] = [];
    const provider = azureProvider({
      resourceName: 'oai-credalent-test',
      credential: { getToken: async () => ({ token: 'entra-token', expiresOnTimestamp: Date.now() + 3_600_000 }) },
      fetch: async (input, init) => {
        requests.push(new Request(input, init));
        return Response.json({
          id: 'chatcmpl-1',
          object: 'chat.completion',
          created: 0,
          model: 'gpt-4.1-mini',
          choices: [{ index: 0, message: { role: 'assistant', content: READY }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 7, completion_tokens: 1, total_tokens: 8 },
        });
      },
    });
    const output = await createAiClient({ provider, budget: memoryTokenBudget() }).generateStructured(draft);

    expect(output).toEqual({ ready: true });
    const [request] = requests;
    expect(request?.url).toBe('https://oai-credalent-test.openai.azure.com/openai/v1/chat/completions?api-version=v1');
    expect(request?.headers.get('authorization')).toBe('Bearer entra-token');
    expect(request?.headers.get('api-key')).toBeNull();
    expect(await request?.json()).toMatchObject({
      model: 'gpt-main',
      response_format: { type: 'json_schema', json_schema: { schema: { properties: { ready: { type: 'boolean' } } } } },
    });
    expect(lastSpan()?.attributes).toMatchObject({
      'credalent.ai.deployment': 'gpt-main',
      'credalent.ai.outcome': 'ok',
    });
  });

  it('selects the fake by configuration, never in pilot or production', () => {
    expect(() => providerFromEnv({ AI_PROVIDER: 'fake', APP_ENV: 'local' })).not.toThrow();
    expect(() => providerFromEnv({ AI_PROVIDER: 'fake', APP_ENV: 'prod' })).toThrow(/local and dev only/);
    // SAFETY: mutation check: went back to refusing only pilot and prod -> the missing and misspelled APP_ENV cases failed
    expect(() => providerFromEnv({ AI_PROVIDER: 'fake' })).toThrow(/local and dev only/);
    expect(() => providerFromEnv({ AI_PROVIDER: 'fake', APP_ENV: 'Pilot' })).toThrow(/local and dev only/);
    expect(() => providerFromEnv({ APP_ENV: 'dev' })).toThrow(/AZURE_OPENAI_RESOURCE_NAME/);
  });

  it('answers from the first fixture whose text is in the prompt, read from AI_FAKE_FIXTURES', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'credalent-ai-')), 'fixtures.json');
    writeFileSync(
      file,
      JSON.stringify([
        { when: 'data engineer', completion: '{"ready":false}' },
        { when: 'flaky engineer', status: 500 },
      ]),
    );
    const { ai, calls } = setup(providerFromEnv({ AI_PROVIDER: 'fake', APP_ENV: 'local', AI_FAKE_FIXTURES: file }));
    await expect(ai.generateStructured(draft)).resolves.toEqual({ ready: false });
    await expect(ai.generateStructured({ ...draft, prompt: 'A flaky engineer.' })).rejects.toBeInstanceOf(
      AiUnavailable,
    );
    expect(calls).toHaveLength(1 + maxAttempts);
    writeFileSync(file, JSON.stringify([{ when: '', completion: '{}' }]));
    expect(() => providerFromEnv({ AI_PROVIDER: 'fake', APP_ENV: 'local', AI_FAKE_FIXTURES: file })).toThrow();
  });
});

describe('Scenario: Unknown tasks are refused', () => {
  it.each([
    [
      'generate',
      (ai: ReturnType<typeof setup>['ai']) => ai.generateStructured({ ...draft, task: 'jobs.unknown' as never }),
    ],
    ['embed', (ai: ReturnType<typeof setup>['ai']) => ai.embed({ task: 'toString' as never, workspaceId, value: 'x' })],
  ])('%s throws UnknownAiTask before any network call', async (_name, run) => {
    const { ai, calls } = setup();
    await expect(run(ai)).rejects.toBeInstanceOf(UnknownAiTask);
    expect(calls).toEqual([]);
  });
});

describe('Scenario: Transient failures are retried', () => {
  it('succeeds after two 429s, backing off, and telemetry records 3 attempts', async () => {
    const { ai, calls, sleeps } = setup(fake({ failures: [429, 429] }));
    await expect(ai.generateStructured(draft)).resolves.toEqual({ ready: true });
    expect(calls).toEqual(['gpt-main', 'gpt-main', 'gpt-main']);
    expect(sleeps).toEqual([1000, 2000]);
    expect(lastSpan()?.attributes).toMatchObject({ 'credalent.ai.attempts': 3, 'credalent.ai.outcome': 'ok' });
  });

  it("waits as long as Azure's retry-after-ms asks", async () => {
    const headers = { 'retry-after-ms': '1500', 'retry-after': '2' };
    const error = new APICallError({
      message: '429',
      url: '',
      requestBodyValues: {},
      statusCode: 429,
      responseHeaders: headers,
    });
    let failed = false;
    const provider: AiProvider = {
      ...fake(),
      languageModel: (deployment) => {
        if (failed) return fake().languageModel(deployment);
        failed = true;
        return new MockLanguageModelV4({ doGenerate: () => Promise.reject(error) });
      },
    };
    const { ai, sleeps } = setup(provider);
    await ai.generateStructured(draft);
    expect(sleeps).toEqual([1500]);
  });

  afterEach(() => vi.restoreAllMocks());

  it('a timed-out attempt is aborted and retried, then reported as a timeout', async () => {
    // AbortSignal.timeout runs on Node's internal timers, which fake timers cannot advance; fire it by hand instead.
    const timers: AbortController[] = [];
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => {
      const controller = new AbortController();
      timers.push(controller);
      return controller.signal;
    });
    const hanging = new MockLanguageModelV4({
      // Never answers; rejects with the signal's reason once aborted, as fetch does.
      doGenerate: ({ abortSignal }) =>
        new Promise((_, reject) => {
          if (abortSignal?.aborted) reject(abortSignal.reason);
          abortSignal?.addEventListener('abort', () => reject(abortSignal.reason));
        }),
    });
    const { ai } = setup({ ...fake(), languageModel: () => hanging });
    const result = ai.generateStructured(draft).catch((e: unknown) => e);
    for (let attempt = 0; attempt < 3; attempt++) {
      await vi.waitFor(() => expect(timers).toHaveLength(attempt + 1));
      timers[attempt]?.abort(new DOMException('timed out', 'TimeoutError'));
    }
    expect(await result).toEqual(new AiUnavailable(draft.task, 'timeout'));
    expect(lastSpan()?.attributes).toMatchObject({ 'credalent.ai.attempts': 3, 'error.type': 'timeout' });
  });

  it('does not retry a request the model refuses (400)', async () => {
    const { ai, calls } = setup(fake({ failures: [400] }));
    await expect(ai.generateStructured(draft)).rejects.toThrow(new AiUnavailable(draft.task, 'http 400'));
    expect(calls).toHaveLength(1);
  });
});

describe('Scenario: The model is down', () => {
  // SAFETY: mutation check: removed `breaker.openUntil > now()` from the attempt loop -> this test failed (the model was called while open)
  it('after 5 failures in a row callers get AiUnavailable and the circuit stays open for 30 seconds', async () => {
    const { ai, calls, clock } = setup(fake({ failures: [503, 503, 503, 503, 503] }));
    await expect(ai.generateStructured(draft)).rejects.toBeInstanceOf(AiUnavailable); // attempts 1-3
    await expect(ai.generateStructured(draft)).rejects.toThrow(new AiUnavailable(draft.task, 'http 503')); // 4-5, opens
    expect(calls).toHaveLength(5);

    clock.now += 29_999;
    await expect(ai.generateStructured(draft)).rejects.toThrow(new AiUnavailable(draft.task, 'circuit open'));
    expect(calls).toHaveLength(5);
    expect(lastSpan()?.attributes).toMatchObject({ 'credalent.ai.outcome': 'circuit_open' });

    clock.now += 2;
    await expect(ai.generateStructured(draft)).resolves.toEqual({ ready: true });
  });

  // SAFETY: mutation check: stored a fresh breaker only on failure, not before the attempt -> this test failed
  it('five concurrent failures count together and open the circuit', async () => {
    const { ai, calls } = setup(fake({ failures: [503, 503, 503, 503, 503] }));
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => ai.generateStructured(draft)));
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    await expect(ai.generateStructured(draft)).rejects.toThrow(new AiUnavailable(draft.task, 'circuit open'));
    expect(calls).toHaveLength(5);
  });
});

describe('Scenario: Telemetry never holds prompt text', () => {
  const cv = 'Sara Al Qahtani, senior data engineer, led the merchant risk pipeline at a BNPL fintech.';
  const personal = /sara|qahtani|merchant risk|bnpl/i;

  // SAFETY: mutation check: added annotateSpan({ 'credalent.ai.prompt': input.prompt }) before generateText -> this test failed
  it('the span has task, latency, tokens and cost, and no field holds the prompt or completion', async () => {
    const { ai } = setup(
      fake({ completion: JSON.stringify({ ready: true, note: 'Sara Al Qahtani shows strong pipeline ownership.' }) }),
    );
    await ai.generateStructured({ ...draft, system: 'You read CVs.', prompt: `Draft from this CV: ${cv}` });

    const span = lastSpan();
    expect(span?.attributes).toMatchObject({
      'credalent.ai.task': 'jobs.draftCompetencies',
      'credalent.ai.deployment': 'gpt-main',
      'credalent.ai.outcome': 'ok',
      'gen_ai.usage.input_tokens': expect.any(Number),
      'gen_ai.usage.output_tokens': expect.any(Number),
      'credalent.ai.cost_usd_micros': expect.any(Number),
    });
    expect(span?.duration).toBeDefined();
    expect(JSON.stringify({ name: span?.name, attributes: span?.attributes, events: span?.events })).not.toMatch(
      personal,
    );
  });

  it('a failure throws an error without the prompt', async () => {
    const { ai } = setup(fake({ failures: [400] }));
    const error = await ai.generateStructured({ ...draft, prompt: cv }).catch((e: unknown) => e);
    expect(JSON.stringify({ message: (error as Error).message, stack: (error as Error).stack })).not.toMatch(personal);
  });
});

describe('Scenario: Workspace budget', () => {
  // The fake counts one token per 4 characters: this prompt spends the whole 2,000,000-token daily budget.
  const everything = { ...draft, prompt: 'x'.repeat(8_000_000) };

  // SAFETY: mutation check: removed the spent >= limit check -> this test failed
  it('throws BudgetExceeded and sends no model request once the day is spent', async () => {
    const { ai, calls, clock } = setup();
    await ai.generateStructured(everything);
    expect(calls).toHaveLength(1);

    await expect(ai.generateStructured(draft)).rejects.toBeInstanceOf(BudgetExceeded);
    await expect(ai.embed({ task: 'search.embed', workspaceId, value: 'x' })).rejects.toBeInstanceOf(BudgetExceeded);
    expect(calls).toHaveLength(1);
    expect(lastSpan()?.attributes).toMatchObject({ 'credalent.ai.outcome': 'budget_exceeded' });

    await expect(
      ai.generateStructured({ ...draft, workspaceId: '0190d4a2-0000-7000-8000-000000000002' }),
    ).resolves.toBeDefined();
    clock.now = Date.parse('2026-11-19T00:00:00Z');
    await expect(ai.generateStructured(draft)).resolves.toBeDefined();
  });

  it("a workspace's own lower budget stops the next call (AIV-P2-038)", async () => {
    const budget = memoryTokenBudget(100_000);
    await budget.add(workspaceId, '2026-11-18', 120_000);
    const { ai, calls } = setup(fake(), undefined, budget);
    await expect(ai.generateStructured(draft)).rejects.toBeInstanceOf(BudgetExceeded);
    expect(calls).toHaveLength(0);
  });

  it('a failed call spends nothing', async () => {
    const budget = memoryTokenBudget();
    const { ai } = setup(fake({ failures: [400] }), undefined, budget);
    await expect(ai.generateStructured(draft)).rejects.toBeInstanceOf(AiUnavailable);
    expect(await budget.spentToday(workspaceId, '2026-11-18')).toEqual({ spent: 0, limit: 2_000_000 });
  });

  // The PostgreSQL store's own failure scenario: tests/integration/src/ai-token-budget.test.ts.
  it.each([
    ['read', { spentToday: () => Promise.reject(new Error('Draft competencies')), add: async () => {} }, 0],
    [
      'written',
      {
        spentToday: async () => ({ spent: 0, limit: 2_000_000 }),
        add: () => Promise.reject(new Error('Draft competencies')),
      },
      1,
    ],
  ] satisfies [string, TokenBudgetStore, number][])(
    'a store that cannot be %s fails closed with AiUnavailable and no prompt in the error',
    async (_, budget, requests) => {
      const { ai, calls } = setup(fake(), undefined, budget);
      const error = await ai.generateStructured(draft).catch((e: unknown) => e);
      expect(error).toEqual(new AiUnavailable(draft.task, 'budget store'));
      expect((error as Error).message).not.toContain('Draft competencies');
      expect(calls).toHaveLength(requests);
      expect(lastSpan()?.attributes).toMatchObject({
        'credalent.ai.outcome': 'unavailable',
        'error.type': 'budget_store',
      });
    },
  );
});

describe('embed', () => {
  it('the fake returns the same 3072-dimension vector for the same text', async () => {
    const { ai, calls } = setup();
    const input = { task: 'search.embed', workspaceId, value: 'Built a streaming ingestion job.' } as const;
    const [a, b] = [await ai.embed(input), await ai.embed(input)];
    expect(a.embedding).toHaveLength(3072);
    expect(a).toEqual(b);
    expect(calls).toEqual(['embedding-main', 'embedding-main']);
  });
});
