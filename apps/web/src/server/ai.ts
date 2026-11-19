import { createAiClient, providerFromEnv, type AiClient } from '@aivera/ai';
import { createAiTokenBudget } from '@aivera/workspaces/composition';
import { getDb } from './db';

let ai: AiClient | undefined;
/**
 * The app's one AI client (ADR-006): Azure with the app's managed identity (`AZURE_OPENAI_RESOURCE_NAME`), or the fake
 * under `AI_PROVIDER=fake` in local and dev. Every call counts against the workspace's daily budget in PostgreSQL.
 */
export const getAi = (): AiClient =>
  (ai ??= createAiClient({ provider: providerFromEnv(process.env), budget: createAiTokenBudget(getDb()) }));
