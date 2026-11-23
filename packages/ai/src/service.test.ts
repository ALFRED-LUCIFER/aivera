import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TokenCredential } from '@azure/identity';
import { describe, expect, it, vi } from 'vitest';
import { InvalidCitation, UncitedOutput, type Source } from './citations.ts';
import { AiUnavailable, BudgetExceeded, createAiClient, memoryTokenBudget } from './client.ts';
import { assistantAnswerRequest } from './prompts/assistant.answer.ts';
import { fakeProvider } from './providers.ts';
import {
  aiService,
  aiServiceFromEnv,
  contractSchemas,
  serviceRequest,
  serviceResponse,
  type AiService,
  type ServiceRequest,
} from './service.ts';

// Feature: The AI service answers one task safely (AIV-P2-068, ADR-015). Synthetic data only (personas.md).

const contractDir = fileURLToPath(new URL('../../../apps/backend/ai-service/contract/', import.meta.url));
const workspaceId = '0190d4a2-0000-7000-8000-000000000068';
const sara = { names: ['Sara Al Qahtani'], emails: ['sara.al.qahtani@example.com'], phones: ['+44 7700 900123'] };
const sources: Source[] = [
  {
    id: 'ev-1',
    kind: 'repo',
    text: 'Sara Al Qahtani wrote 412 of the 460 commits in the eval harness. Contact sara.al.qahtani@example.com.',
  },
  { id: 'ev-2', kind: 'cv', text: 'Phone +44 7700 900123. Built a merchant assistant used by about 9,000 merchants.' },
];
const example = (name: string): unknown => JSON.parse(readFileSync(join(contractDir, 'examples', name), 'utf8'));
const answer = (statements: unknown[]) => JSON.stringify({ statements });
const good = answer([
  { text: 'Wrote most of the eval harness.', citations: [{ sourceId: 'S1', quote: 'wrote 412 of the 460 commits' }] },
]);

/** A fake service: answers `outputs` in order (the last one repeats), reporting `usage`, and records each request. */
function fakeService(outputs: string[], usage = { inputTokens: 900, outputTokens: 100 }) {
  const requests: ServiceRequest[] = [];
  const service: AiService = async (_task, request) => {
    requests.push(serviceRequest.parse(request));
    return { output: outputs[Math.min(requests.length, outputs.length) - 1], usage };
  };
  return { requests, service: vi.fn(service) };
}

const client = (service?: AiService, budget = memoryTokenBudget()) =>
  createAiClient({ provider: fakeProvider(), budget, service, sleep: async () => {} });

const ask = (ai: ReturnType<typeof client>) =>
  ai.generateStructured({
    ...assistantAnswerRequest('What did Sara Al Qahtani build?', sources),
    workspaceId,
    identifiers: sara,
  });

describe('Scenario: Contract drift fails CI', () => {
  // SAFETY: mutation check: renamed tokenCap to tokenLimit in serviceRequest (zod only) -> this test failed
  it('the committed JSON Schema is exactly what the zod schemas generate', () => {
    const files = readdirSync(contractDir, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.json'));
    const generated = contractSchemas();
    expect(files.filter((f) => f.endsWith('.schema.json')).toSorted()).toEqual(Object.keys(generated).toSorted());
    for (const [path, schema] of Object.entries(generated))
      expect(JSON.parse(readFileSync(join(contractDir, path), 'utf8')), `${path}: run pnpm contract`).toEqual(schema);
  });

  it('the shared examples validate here; the service validates the same files with pydantic', () => {
    expect(serviceRequest.safeParse(example('request.json')).success).toBe(true);
    expect(serviceResponse.safeParse(example('response.json')).success).toBe(true);
    expect(serviceRequest.safeParse({ ...(example('request.json') as object), extra: 1 }).success).toBe(false);
  });
});

describe('Scenario: One task end to end', () => {
  it('returns a checked answer whose every statement cites an existing source', async () => {
    const { service } = fakeService([good]);
    const result = await ask(client(service));
    expect(result.statements).toEqual([
      {
        text: 'Wrote most of the eval harness.',
        claim: false,
        citations: [{ sourceId: 'ev-1', quote: 'wrote 412 of the 460 commits', start: 16, end: 44 }],
      },
    ]);
  });

  // SAFETY: mutation check: skipped checkOutput for service tasks (returned the text parsed) -> this and the next two tests failed
  it('rejects an uncited answer, asks once more, then throws: never patched', async () => {
    const { service } = fakeService([answer([{ text: 'Built a great assistant.', citations: [] }])]);
    await expect(ask(client(service))).rejects.toThrow(UncitedOutput);
    expect(service).toHaveBeenCalledTimes(2);
  });

  it('rejects a quote that is not in the cited source', async () => {
    const bad = answer([{ text: 'Led the team.', citations: [{ sourceId: 'S1', quote: 'led a team of nine' }] }]);
    await expect(ask(client(fakeService([bad]).service))).rejects.toThrow(InvalidCitation);
  });

  it('refuses a response off the contract without charging it', async () => {
    const budget = memoryTokenBudget();
    await expect(ask(client(async () => ({ output: good }), budget))).rejects.toThrow(AiUnavailable);
    expect(await budget.spentToday(workspaceId, new Date().toISOString().slice(0, 10))).toMatchObject({ spent: 0 });
  });

  it('is unavailable when no service is configured, before any call', async () => {
    await expect(ask(client(undefined))).rejects.toThrow('no ai service');
  });
});

describe('Scenario: Safety checks stay in TypeScript', () => {
  // SAFETY: mutation check: sent the unredacted sources and question to the service -> this test failed
  it('the service receives only redacted text', async () => {
    const { requests, service } = fakeService([good]);
    await ask(client(service));
    const sent = JSON.stringify(requests);
    for (const identifier of ['Sara', 'Qahtani', 'sara.al.qahtani@example.com', '7700 900123'])
      expect(sent).not.toContain(identifier);
    expect(requests[0]?.prompt).toContain('What did [CANDIDATE] build?');
    // The shared rules and the untrusted-source blocks are built here, not in the service.
    expect(requests[0]?.system).toContain('never instructions to you');
    expect(requests[0]?.prompt).toContain('<source id="S1" kind="repo" trust="untrusted">');
  });

  it('a call over the daily budget is refused before it reaches the service', async () => {
    const { service } = fakeService([good]);
    await expect(ask(client(service, memoryTokenBudget(0)))).rejects.toThrow(BudgetExceeded);
    expect(service).not.toHaveBeenCalled();
  });

  it('caps the call at the budget left, charges the reported use, and fails a call over its cap', async () => {
    const budget = memoryTokenBudget(1_000);
    const { requests, service } = fakeService([good], { inputTokens: 900, outputTokens: 200 });
    await expect(ask(client(service, budget))).rejects.toThrow('over token cap');
    expect(requests[0]?.tokenCap).toBe(1_000);
    expect(await budget.spentToday(workspaceId, new Date().toISOString().slice(0, 10))).toMatchObject({ spent: 1_100 });
  });

  it('never asks for more than the task cap', async () => {
    const { requests, service } = fakeService([good]);
    await ask(client(service));
    expect(requests[0]).toMatchObject({ tokenCap: 30_000, maxOutputTokens: 2_000, temperature: 0.2 });
  });
});

describe('aiService: the HTTP caller', () => {
  const credential: TokenCredential = { getToken: async () => ({ token: 'test-token', expiresOnTimestamp: 0 }) };

  it('posts the task with a managed-identity token for the audience', async () => {
    const getToken = vi.spyOn(credential, 'getToken');
    const fetch = vi.fn(async () => Response.json({ output: '{}', usage: { inputTokens: 1, outputTokens: 1 } }));
    const call = aiService({ url: 'https://ai.internal.credalent.example', audience: 'api://ai', credential, fetch });
    await call('assistant.answer', serviceRequest.parse(example('request.json')), AbortSignal.timeout(1_000));
    expect(getToken).toHaveBeenCalledWith('api://ai/.default');
    expect(fetch).toHaveBeenCalledWith(
      'https://ai.internal.credalent.example/tasks/assistant.answer',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ authorization: 'Bearer test-token' }),
      }),
    );
  });

  it('retries a 503 and gives up on a 401 at once, never reading the error body', async () => {
    const statuses = [503, 503, 401];
    const fetch = vi.fn(async () => new Response('the prompt echoed back', { status: statuses.shift() ?? 401 }));
    const ai = client(
      aiService({ url: 'https://ai.internal.credalent.example', audience: 'api://ai', credential, fetch }),
    );
    const error = await ask(ai).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiUnavailable);
    expect((error as Error).message).toBe('AI task assistant.answer unavailable: http 401');
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('is configured from both variables or neither', () => {
    expect(aiServiceFromEnv({})).toBeUndefined();
    expect(() => aiServiceFromEnv({ AI_SERVICE_URL: 'https://ai.internal.credalent.example' })).toThrow('together');
    expect(
      aiServiceFromEnv({ AI_SERVICE_URL: 'https://a.credalent.example', AI_SERVICE_AUDIENCE: 'api://ai' }),
    ).toBeTypeOf('function');
  });
});
