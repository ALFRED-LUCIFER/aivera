// The only place that talks to a model (AIV-P0-027, ADR-006). Callers name a task from config.ts.
export { AiUnavailable, BudgetExceeded, createAiClient, UnknownAiTask, type AiClient } from './client';
export type { EmbedTask, GenerateTask } from './config';
export { azureProvider, fakeProvider, FAKE_COMPLETION, providerFromEnv, type AiProvider } from './providers';
