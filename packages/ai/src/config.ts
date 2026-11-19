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
  // The eval harness's LLM judge (AIV-P0-029): a short verdict, as repeatable as the model allows.
  'evals.judge': { deployment: 'gpt-main', timeoutMs: 60_000, maxOutputTokens: 300, temperature: 0 },
} as const satisfies Record<string, TaskSettings>;

export const embedTasks = {
  'evidence.embed': { deployment: 'embedding-main', timeoutMs: 15_000 },
} as const satisfies Record<string, TaskSettings>;

export type GenerateTask = keyof typeof generateTasks;
export type EmbedTask = keyof typeof embedTasks;

/** Attempts per call: the first plus two retries on 429, 5xx or a timeout. */
export const maxAttempts = 3;

/** Consecutive failed attempts on one deployment that open its circuit, and how long it stays open. */
export const circuitBreaker = { failures: 5, openMs: 30_000 };
