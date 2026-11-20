// The one place a task picks its model (AIV-P0-027, ADR-006). Modules name a task; they never name a deployment.
// Deployments live on the Azure AI resource the client is created with. Dev's is in UAE North, gpt-main on Global
// Standard (ADR-011); the pilot's must infer in region. A model goes here only once it is deployable in UAE North.

// Prices are list prices in USD micros per million tokens, for the telemetry's cost estimate only (not billing).
// shortcut: hand-copied list prices, November 2026; recheck when a deployment or its model changes
export const deployments = {
  'gpt-main': { model: 'gpt-4.1-mini', inputPerMillion: 400_000, outputPerMillion: 1_600_000 },
  'embedding-main': { model: 'text-embedding-3-large', inputPerMillion: 130_000, outputPerMillion: 0 },
} as const;

export type Deployment = keyof typeof deployments;

type TaskSettings = { deployment: Deployment; timeoutMs: number; maxOutputTokens?: number; temperature?: number };

export const generateTasks = {
  'jobs.draftCompetencies': { deployment: 'gpt-main', timeoutMs: 60_000, maxOutputTokens: 4_000, temperature: 0.2 },
  // A short answer: one domain and at most three regions, each with a quote.
  'jobs.detectDomain': { deployment: 'gpt-main', timeoutMs: 30_000, maxOutputTokens: 600, temperature: 0 },
  // Up to 40 cited links and 3 checks for one candidate's sources (AIV-P1-027).
  'evidence.mapToCompetency': { deployment: 'gpt-main', timeoutMs: 60_000, maxOutputTokens: 6_000, temperature: 0 },
  // A CV's statements, skills and roles, each with a quote: long, and as repeatable as the model allows (AIV-P1-025).
  'evidence.parseCv': { deployment: 'gpt-main', timeoutMs: 90_000, maxOutputTokens: 8_000, temperature: 0 },
  // The eval harness's LLM judge (AIV-P0-029): a short verdict, as repeatable as the model allows.
  'evals.judge': { deployment: 'gpt-main', timeoutMs: 60_000, maxOutputTokens: 300, temperature: 0 },
} as const satisfies Record<string, TaskSettings>;

export const embedTasks = {
  // Indexing and searching search.chunk (AIV-P0-030): one task, so a query and its documents share a model.
  'search.embed': { deployment: 'embedding-main', timeoutMs: 15_000 },
} as const satisfies Record<string, TaskSettings>;

export type GenerateTask = keyof typeof generateTasks;

/** The model behind a task's deployment, stored with what the task produced (AIV-P1-027). */
export const modelOf = (task: GenerateTask): string => deployments[generateTasks[task].deployment].model;
export type EmbedTask = keyof typeof embedTasks;

/** Attempts per call: the first plus two retries on 429, 5xx or a timeout. */
export const maxAttempts = 3;

/** Consecutive failed attempts on one deployment that open its circuit, and how long it stays open. */
export const circuitBreaker = { failures: 5, openMs: 30_000 };
