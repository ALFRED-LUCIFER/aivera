// The only place that talks to a model (AIV-P0-027, ADR-006). Callers name a task from config.ts.
export {
  AiUnavailable,
  BudgetExceeded,
  createAiClient,
  UnknownAiTask,
  type AiClient,
  type TokenBudgetStore,
} from './client';
export {
  cited,
  InvalidCitation,
  SchemaMismatch,
  UncitedOutput,
  type Checked,
  type Citation,
  type Source,
  type SourceKind,
} from './citations';
export type { EmbedTask, GenerateTask } from './config';
export { azureProvider, fakeProvider, providerFromEnv, type AiProvider } from './providers';
