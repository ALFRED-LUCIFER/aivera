import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { cited } from './citations';
import { createAiClient, memoryTokenBudget } from './client';
import { azureProvider } from './providers';

// Opt-in smoke test against the Azure dev resource, skipped in PR CI. Signs in with `az login` (DefaultAzureCredential):
//   AI_LIVE_SMOKE=1 AZURE_OPENAI_RESOURCE_NAME=<dev resource> pnpm --filter @credalent/ai test src/live.test.ts
const resourceName = process.env['AZURE_OPENAI_RESOURCE_NAME'];

describe.skipIf(!process.env['AI_LIVE_SMOKE'] || !resourceName)('live Azure OpenAI smoke test', () => {
  const ai = createAiClient({
    provider: azureProvider({ resourceName: resourceName ?? '' }),
    budget: memoryTokenBudget(),
  });
  const workspaceId = '0190d4a2-0000-7000-8000-00000000f00d';

  it('generates cited structured output with gpt-main and embeds with embedding-main', async () => {
    const description = 'Senior AI Engineer. You will ship a retrieval assistant used by 9,000 merchants.';
    const { needs } = await ai.generateStructured({
      task: 'jobs.draftCompetencies',
      workspaceId,
      promptVersion: 'smoke.needs@1',
      system: 'List the needs the job description states.',
      prompt: 'List the needs.',
      schema: z.object({ needs: z.array(cited(z.object({ need: z.string() }))) }),
      sources: [{ id: 'jd', kind: 'job_description', text: description }],
    });
    expect(needs.length).toBeGreaterThan(0);
    expect(needs[0]?.citations[0]?.sourceId).toBe('jd');
    const { embedding } = await ai.embed({ task: 'evidence.embed', workspaceId, value: 'synthetic smoke test' });
    expect(embedding).toHaveLength(3072);
  }, 60_000);
});
