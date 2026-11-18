import { context, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AiUnavailable, BudgetExceeded, createAiClient, UnknownAiTask } from './client';
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
const lastSpan = () => spans.getFinishedSpans().at(-1);

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

function setup(provider = fakeProvider(), start = Date.parse('2026-11-18T09:00:00Z')) {
  const clock = { now: start };
  const sleeps: number[] = [];
  const spy = counted(provider);
  const ai = createAiClient({
    provider: spy.provider,
    now: () => clock.now,
    sleep: async (ms) => void sleeps.push(ms),
  });
  return { ai, clock, sleeps, calls: spy.calls };
}

const draft = {
  task: 'jobs.draftCompetencies',
  workspaceId,
  prompt: 'Draft competencies for a data engineer.',
} as const;

describe('Scenario: A task resolves to its configured deployment', () => {
  it('sends jobs.draftCompetencies to gpt-main with a managed-identity token and no API key', async () => {
    const requests: Request[] = [];
    const provider = azureProvider({
      resourceName: 'oai-aivera-test',
      credential: { getToken: async () => ({ token: 'entra-token', expiresOnTimestamp: Date.now() + 3_600_000 }) },
      fetch: async (input, init) => {
        requests.push(new Request(input, init));
        return Response.json({
          id: 'chatcmpl-1',
          object: 'chat.completion',
          created: 0,
          model: 'gpt-4.1-mini',
          choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 7, completion_tokens: 1, total_tokens: 8 },
        });
      },
    });
    const { text } = await createAiClient({ provider }).generate(draft);

    expect(text).toBe('ok');
    const [request] = requests;
    expect(request?.url).toBe('https://oai-aivera-test.openai.azure.com/openai/v1/chat/completions?api-version=v1');
    expect(request?.headers.get('authorization')).toBe('Bearer entra-token');
    expect(request?.headers.get('api-key')).toBeNull();
    expect(await request?.json()).toMatchObject({ model: 'gpt-main' });
    expect(lastSpan()?.attributes).toMatchObject({ 'aivera.ai.deployment': 'gpt-main', 'aivera.ai.outcome': 'ok' });
  });

  it('selects the fake by configuration, never in pilot or production', () => {
    expect(() => providerFromEnv({ AI_PROVIDER: 'fake', APP_ENV: 'local' })).not.toThrow();
    expect(() => providerFromEnv({ AI_PROVIDER: 'fake', APP_ENV: 'prod' })).toThrow(/local and dev only/);
    expect(() => providerFromEnv({ APP_ENV: 'dev' })).toThrow(/AZURE_OPENAI_RESOURCE_NAME/);
  });
});

describe('Scenario: Unknown tasks are refused', () => {
  it.each([
    ['generate', (ai: ReturnType<typeof setup>['ai']) => ai.generate({ ...draft, task: 'jobs.unknown' as never })],
    ['embed', (ai: ReturnType<typeof setup>['ai']) => ai.embed({ task: 'toString' as never, workspaceId, value: 'x' })],
  ])('%s throws UnknownAiTask before any network call', async (_name, run) => {
    const { ai, calls } = setup();
    await expect(run(ai)).rejects.toBeInstanceOf(UnknownAiTask);
    expect(calls).toEqual([]);
  });
});

describe('Scenario: Transient failures are retried', () => {
  it('succeeds after two 429s, backing off, and telemetry records 3 attempts', async () => {
    const { ai, calls, sleeps } = setup(fakeProvider({ failures: [429, 429] }));
    await expect(ai.generate(draft)).resolves.toEqual({ text: '[fake completion]' });
    expect(calls).toEqual(['gpt-main', 'gpt-main', 'gpt-main']);
    expect(sleeps).toEqual([1000, 2000]);
    expect(lastSpan()?.attributes).toMatchObject({ 'aivera.ai.attempts': 3, 'aivera.ai.outcome': 'ok' });
  });

  it('does not retry a request the model refuses (400)', async () => {
    const { ai, calls } = setup(fakeProvider({ failures: [400] }));
    await expect(ai.generate(draft)).rejects.toThrow(new AiUnavailable(draft.task, 'http 400'));
    expect(calls).toHaveLength(1);
  });
});

describe('Scenario: The model is down', () => {
  // SAFETY: mutation check: removed `breaker.openUntil > now()` from the attempt loop -> this test failed (the model was called while open)
  it('after 5 failures in a row callers get AiUnavailable and the circuit stays open for 30 seconds', async () => {
    const { ai, calls, clock } = setup(fakeProvider({ failures: [503, 503, 503, 503, 503] }));
    await expect(ai.generate(draft)).rejects.toBeInstanceOf(AiUnavailable); // attempts 1-3
    await expect(ai.generate(draft)).rejects.toThrow(new AiUnavailable(draft.task, 'http 503')); // 4-5, opens
    expect(calls).toHaveLength(5);

    clock.now += 29_999;
    await expect(ai.generate(draft)).rejects.toThrow(new AiUnavailable(draft.task, 'circuit open'));
    expect(calls).toHaveLength(5);
    expect(lastSpan()?.attributes).toMatchObject({ 'aivera.ai.outcome': 'circuit_open' });

    clock.now += 2;
    await expect(ai.generate(draft)).resolves.toEqual({ text: '[fake completion]' });
  });
});

describe('Scenario: Telemetry never holds prompt text', () => {
  const cv = 'Sara Al Qahtani, senior data engineer, led the merchant risk pipeline at a BNPL fintech.';
  const personal = /sara|qahtani|merchant risk|bnpl/i;

  // SAFETY: mutation check: added annotateSpan({ 'aivera.ai.prompt': input.prompt }) before generateText -> this test failed
  it('the span has task, latency, tokens and cost, and no field holds the prompt or completion', async () => {
    const { ai } = setup(fakeProvider({ completion: 'Sara Al Qahtani shows strong pipeline ownership.' }));
    await ai.generate({ ...draft, system: 'You read CVs.', prompt: `Draft from this CV: ${cv}` });

    const span = lastSpan();
    expect(span?.attributes).toMatchObject({
      'aivera.ai.task': 'jobs.draftCompetencies',
      'aivera.ai.deployment': 'gpt-main',
      'aivera.ai.outcome': 'ok',
      'gen_ai.usage.input_tokens': expect.any(Number),
      'gen_ai.usage.output_tokens': expect.any(Number),
      'aivera.ai.cost_usd_micros': expect.any(Number),
    });
    expect(span?.duration).toBeDefined();
    expect(JSON.stringify({ name: span?.name, attributes: span?.attributes, events: span?.events })).not.toMatch(
      personal,
    );
  });

  it('a failure throws an error without the prompt', async () => {
    const { ai } = setup(fakeProvider({ failures: [400] }));
    const error = await ai.generate({ ...draft, prompt: cv }).catch((e: unknown) => e);
    expect(JSON.stringify({ message: (error as Error).message, stack: (error as Error).stack })).not.toMatch(personal);
  });
});

describe('Scenario: Workspace budget', () => {
  // The fake counts one token per 4 characters: this prompt spends the whole 2,000,000-token daily budget.
  const everything = { ...draft, prompt: 'x'.repeat(8_000_000) };

  // SAFETY: mutation check: removed the spentToday(workspaceId) >= dailyTokenBudgetPerWorkspace check -> this test failed
  it('throws BudgetExceeded and sends no model request once the day is spent', async () => {
    const { ai, calls, clock } = setup();
    await ai.generate(everything);
    expect(calls).toHaveLength(1);

    await expect(ai.generate(draft)).rejects.toBeInstanceOf(BudgetExceeded);
    await expect(ai.embed({ task: 'evidence.embed', workspaceId, value: 'x' })).rejects.toBeInstanceOf(BudgetExceeded);
    expect(calls).toHaveLength(1);
    expect(lastSpan()?.attributes).toMatchObject({ 'aivera.ai.outcome': 'budget_exceeded' });

    await expect(ai.generate({ ...draft, workspaceId: '0190d4a2-0000-7000-8000-000000000002' })).resolves.toBeDefined();
    clock.now = Date.parse('2026-11-19T00:00:00Z');
    await expect(ai.generate(draft)).resolves.toBeDefined();
  });
});

describe('embed', () => {
  it('the fake returns the same 3072-dimension vector for the same text', async () => {
    const { ai, calls } = setup();
    const input = { task: 'evidence.embed', workspaceId, value: 'Built a streaming ingestion job.' } as const;
    const [a, b] = [await ai.embed(input), await ai.embed(input)];
    expect(a.embedding).toHaveLength(3072);
    expect(a).toEqual(b);
    expect(calls).toEqual(['embedding-main', 'embedding-main']);
  });
});
