// The only place that talks to a model (AIV-P0-027, ADR-006). Callers name a task from config.ts.
export {
  AiUnavailable,
  BudgetExceeded,
  createAiClient,
  UnknownAiTask,
  type AiClient,
  type TokenBudgetStore,
} from './client.ts';
export {
  cited,
  InvalidCitation,
  SchemaMismatch,
  UncitedOutput,
  type Checked,
  type Citation,
  type Source,
  type SourceKind,
} from './citations.ts';
export { modelOf, type EmbedTask, type GenerateTask } from './config.ts';
export { detectUnusualContent, type UnusualContent } from './untrusted.ts';
export { azureProvider, fakeProvider, providerFromEnv, type AiProvider } from './providers.ts';
export {
  DRAFT_COMPETENCIES_SYSTEM,
  DRAFT_COMPETENCIES_VERSION,
  draftCompetenciesRequest,
  draftCompetenciesSchema,
} from './prompts/jobs.draftCompetencies.ts';
export {
  DETECT_DOMAIN_SYSTEM,
  DETECT_DOMAIN_VERSION,
  detectDomainRequest,
  detectDomainSchema,
} from './prompts/jobs.detectDomain.ts';
// The system prompt is exported so eval.test.ts checks it never repeats or overrides the shared untrusted-content rule.
export {
  MAP_TO_COMPETENCY_SYSTEM,
  MAP_TO_COMPETENCY_VERSION,
  mapToCompetencyRequest,
} from './prompts/evidence.mapToCompetency.ts';
