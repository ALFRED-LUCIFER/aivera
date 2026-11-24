import { AiUnavailable, aiServiceFromEnv, createAiClient, providerFromEnv, type AiClient } from '@credalent/ai';
import { createAiTokenBudget } from '@credalent/workspaces/composition';
import { getDb } from './db';

let ai: AiClient | undefined;
/**
 * The app's one AI client (ADR-006): Azure with the app's managed identity (`AZURE_OPENAI_RESOURCE_NAME`), or the fake
 * under `AI_PROVIDER=fake` in local and dev. Every call counts against the workspace's daily budget in PostgreSQL.
 * Tasks served by the Python AI service (ADR-015) go to `AI_SERVICE_URL` when it is set.
 */
export const getAi = (): AiClient =>
  (ai ??= createAiClient({
    provider: providerFromEnv(process.env),
    budget: createAiTokenBudget(getDb()),
    service: aiServiceFromEnv(process.env),
  }));

/**
 * `getAi` for a caller that has a fallback (the ranking explanation's template): an app with no AI configured throws
 * `AiUnavailable` at the call, not at start-up, so the fallback runs instead of an error page. The construction error
 * is dropped: it names configuration, nothing a caller needs.
 */
export const aiOrUnavailable = (task: string, get: () => AiClient = getAi): Pick<AiClient, 'generateStructured'> => ({
  generateStructured: (input) => {
    let client: AiClient;
    try {
      client = get();
    } catch {
      throw new AiUnavailable(task, 'not configured');
    }
    return client.generateStructured(input);
  },
});
