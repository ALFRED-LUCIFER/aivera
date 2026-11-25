// The only place that talks to a model (AIV-P0-027, ADR-006). Callers name a task from config.ts.
export {
  AiUnavailable,
  BudgetExceeded,
  createAiClient,
  memoryTokenBudget,
  MAX_CALL_SOURCE_CHARS,
  MAX_SOURCE_CHARS,
  SourceTooLong,
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
export {
  CANDIDATE_PLACEHOLDER,
  CONTACT_EXTRACTION_TASKS,
  MissingIdentifiers,
  type Identifiers,
} from './identifiers.ts';
export { modelOf, type EmbedTask, type GenerateTask } from './config.ts';
export { detectUnusualContent, type UnusualContent } from './untrusted.ts';
export { azureProvider, fakeProvider, providerFromEnv, type AiProvider } from './providers.ts';
export {
  DRAFT_COMPETENCIES_SYSTEM,
  DRAFT_COMPETENCIES_VERSION,
  draftCompetenciesRequest,
  draftCompetenciesSchema,
} from './prompts/jobs.draftCompetencies.ts';
export { PARSE_CV_SYSTEM, PARSE_CV_VERSION, parseCvRequest, parseCvSchema } from './prompts/evidence.parseCv.ts';
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
export {
  COMPARE_EXCERPTS_SYSTEM,
  COMPARE_EXCERPTS_VERSION,
  compareExcerptsRequest,
  flaggedPairs,
} from './prompts/evidence.compareExcerpts.ts';
export { EXPLAIN_RANKING_VERSION, explainRankingRequest, figuresQuoted } from './prompts/assessment.explainRanking.ts';
export {
  SUGGEST_QUESTIONS_SYSTEM,
  SUGGEST_QUESTIONS_VERSION,
  suggestQuestionsRequest,
  type QuestionGapInput,
} from './prompts/assessment.suggestQuestions.ts';
export {
  MAP_SUMMARY_SYSTEM,
  MAP_SUMMARY_VERSION,
  mapSummaryRequest,
  type SummaryCompetencyInput,
} from './prompts/interviews.mapSummary.ts';
export {
  ASSISTANT_ANSWER_SYSTEM,
  ASSISTANT_ANSWER_VERSION,
  assistantAnswerRequest,
  assistantAnswerSchema,
} from './prompts/assistant.answer.ts';
export { aiServiceFromEnv } from './service.ts';
