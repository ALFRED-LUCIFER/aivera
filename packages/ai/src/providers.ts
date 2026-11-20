import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createAzure } from '@ai-sdk/azure';
import { DefaultAzureCredential, getBearerTokenProvider, type TokenCredential } from '@azure/identity';
import { APICallError, type EmbeddingModel, type LanguageModel } from 'ai';
// The SDK's mock models carry the fake (a deliverable, selected by AI_PROVIDER); ai/test has no test-runner imports.
import { MockEmbeddingModelV4, MockLanguageModelV4 } from 'ai/test';
import { z } from 'zod';

/** Where a deployment name becomes a model. The client is the only caller. */
export type AiProvider = {
  languageModel(deployment: string): LanguageModel;
  embeddingModel(deployment: string): EmbeddingModel;
};

/**
 * Azure OpenAI on AI Foundry, signed in with the app's managed identity (Entra token, never an API key). Locally,
 * DefaultAzureCredential falls back to `az login`, which the opt-in live smoke test uses.
 */
export function azureProvider(options: {
  resourceName: string;
  credential?: TokenCredential;
  fetch?: typeof fetch;
}): AiProvider {
  // In Azure, DefaultAzureCredential picks the user-assigned identity named by AZURE_CLIENT_ID (set in web.bicep).
  const credential = options.credential ?? new DefaultAzureCredential();
  const azure = createAzure({
    resourceName: options.resourceName,
    tokenProvider: getBearerTokenProvider(credential, 'https://cognitiveservices.azure.com/.default'),
    ...(options.fetch && { fetch: options.fetch }),
  });
  return { languageModel: (deployment) => azure.chat(deployment), embeddingModel: (d) => azure.embedding(d) };
}

/**
 * A canned answer for every prompt whose JSON text contains `when` (`"Title: Senior AI Engineer"`): a completion, or an
 * HTTP status every attempt fails with. The first match wins. End-to-end tests load them from `AI_FAKE_FIXTURES`.
 */
const fakeFixtures = z.array(
  z.union([
    z.object({ when: z.string().min(1), completion: z.string() }),
    z.object({ when: z.string().min(1), status: z.number().int().min(400).max(599) }),
  ]),
);
type FakeFixture = z.infer<typeof fakeFixtures>[number];

const FAKE_DIMENSIONS = 3072; // text-embedding-3-large
const tokens = (text: string) => Math.ceil(text.length / 4);

const fakeError = (statusCode: number) =>
  new APICallError({
    message: `fake ${statusCode}`,
    url: 'https://fake.credalent.example',
    requestBodyValues: {},
    statusCode,
  });

/**
 * Deterministic model for unit, integration and end-to-end tests: a fixed completion (or the first matching fixture's),
 * token counts from the input length, an embedding hashed from the text. `failures` lists HTTP statuses the next
 * attempts fail with, in order.
 */
export function fakeProvider(
  options: { completion?: string; failures?: number[]; fixtures?: readonly FakeFixture[] } = {},
): AiProvider {
  const failures = [...(options.failures ?? [])];
  const failNext = () => {
    const statusCode = failures.shift();
    if (statusCode !== undefined) throw fakeError(statusCode);
  };
  return {
    languageModel: (deployment) =>
      new MockLanguageModelV4({
        provider: 'fake',
        modelId: deployment,
        doGenerate: async ({ prompt }) => {
          failNext();
          const asked = JSON.stringify(prompt);
          const fixture = options.fixtures?.find((f) => asked.includes(f.when));
          if (fixture && 'status' in fixture) throw fakeError(fixture.status);
          const text = fixture?.completion ?? options.completion ?? '{}'; // callers pass output that matches their schema
          return {
            content: [{ type: 'text', text }],
            finishReason: { unified: 'stop', raw: 'stop' },
            usage: {
              inputTokens: { total: tokens(JSON.stringify(prompt)), noCache: undefined, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: tokens(text), text: tokens(text), reasoning: 0 },
            },
            warnings: [],
          };
        },
      }),
    embeddingModel: (deployment) =>
      new MockEmbeddingModelV4({
        provider: 'fake',
        modelId: deployment,
        doEmbed: async ({ values }) => {
          failNext();
          return {
            embeddings: values.map((value) => {
              const bytes = createHash('sha256').update(value).digest();
              return Array.from({ length: FAKE_DIMENSIONS }, (_, i) => (bytes[i % bytes.length] ?? 0) / 255);
            }),
            usage: { tokens: values.reduce((sum, value) => sum + tokens(value), 0) },
            warnings: [],
          };
        },
      }),
  };
}

/**
 * Selects the provider from configuration: `AI_PROVIDER=fake` for tests, otherwise Azure with managed identity. The fake
 * answers from the JSON fixture file at `AI_FAKE_FIXTURES` when one is named (end-to-end tests).
 */
export function providerFromEnv(env: Record<string, string | undefined>): AiProvider {
  if (env['AI_PROVIDER'] === 'fake') {
    // A fake completion must never reach a real recruiter: allow it only where APP_ENV says local or dev.
    if (env['APP_ENV'] !== 'local' && env['APP_ENV'] !== 'dev')
      throw new Error('AI_PROVIDER=fake is local and dev only');
    const file = env['AI_FAKE_FIXTURES'];
    return fakeProvider(file ? { fixtures: fakeFixtures.parse(JSON.parse(readFileSync(file, 'utf8'))) } : {});
  }
  const resourceName = env['AZURE_OPENAI_RESOURCE_NAME'];
  if (!resourceName) throw new Error('Invalid configuration, missing or invalid: AZURE_OPENAI_RESOURCE_NAME');
  return azureProvider({ resourceName });
}
