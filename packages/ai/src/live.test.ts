import { describe, expect, it } from 'vitest';
import { createAiClient } from './client';
import { azureProvider } from './providers';

// Opt-in smoke test against the Azure dev resource, skipped in PR CI. Signs in with `az login` (DefaultAzureCredential):
//   AI_LIVE_SMOKE=1 AZURE_OPENAI_RESOURCE_NAME=<dev resource> pnpm --filter @aivera/ai test src/live.test.ts
const resourceName = process.env['AZURE_OPENAI_RESOURCE_NAME'];

describe.skipIf(!process.env['AI_LIVE_SMOKE'] || !resourceName)('live Azure OpenAI smoke test', () => {
  const ai = createAiClient({ provider: azureProvider({ resourceName: resourceName ?? '' }) });
  const workspaceId = '0190d4a2-0000-7000-8000-00000000f00d';

  it('generates with gpt-main and embeds with embedding-main', async () => {
    const { text } = await ai.generate({
      task: 'jobs.draftCompetencies',
      workspaceId,
      prompt: 'Reply with the single word: ready',
    });
    expect(text.length).toBeGreaterThan(0);
    const { embedding } = await ai.embed({ task: 'evidence.embed', workspaceId, value: 'synthetic smoke test' });
    expect(embedding).toHaveLength(3072);
  }, 60_000);
});
