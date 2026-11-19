import { annotateSpan, withSpan } from '@aivera/observability';
import { APICallError, embed as sdkEmbed, generateText } from 'ai';
import {
  circuitBreaker,
  deployments,
  embedTasks,
  generateTasks,
  maxAttempts,
  type Deployment,
  type EmbedTask,
  type GenerateTask,
} from './config';
import type { AiProvider } from './providers';

// Every error carries the task and a safe reason only: never the prompt, the completion or the provider's error,
// whose request body repeats the prompt (AGENTS.md 1.2).

/** A task name not in config.ts. A programming error, thrown before any network call. */
export class UnknownAiTask extends Error {
  override name = 'UnknownAiTask';
  constructor(task: string) {
    super(`Unknown AI task: ${task}`);
  }
}

/** The model could not answer. Callers show "Aivera could not draft this right now." */
export class AiUnavailable extends Error {
  override name = 'AiUnavailable';
  constructor(task: string, reason: string) {
    super(`AI task ${task} unavailable: ${reason}`);
  }
}

/** The workspace has spent its daily token budget; no request was sent. */
export class BudgetExceeded extends Error {
  override name = 'BudgetExceeded';
  constructor(task: string, workspaceId: string) {
    super(`Daily AI token budget used for workspace ${workspaceId} (task ${task})`);
  }
}

// Task names come from typed callers, but a cast or a stored name can still be wrong; checked before any call.
function settingsOf<T>(tasks: Record<string, T>, task: string): T {
  if (!Object.hasOwn(tasks, task)) throw new UnknownAiTask(task);
  return tasks[task] as T;
}

const outcome = (value: string, extra: Record<string, string | number> = {}) =>
  annotateSpan({ 'aivera.ai.outcome': value, ...extra });

type Usage = { inputTokens: number; outputTokens: number };

/**
 * Tokens spent per workspace and UTC day (`YYYY-MM-DD`), and the workspace's daily budget. Apps pass the PostgreSQL
 * store (`createAiTokenBudget` from `@aivera/workspaces/composition`, AIV-P0-033), so every process shares one count
 * and reads an operator's per-workspace budget (AIV-P2-038); tests pass `memoryTokenBudget()`.
 */
export interface TokenBudgetStore {
  /** Input plus output tokens spent on `day`, and the input plus output tokens the workspace may spend per UTC day. */
  spentToday(workspaceId: string, day: string): Promise<{ spent: number; limit: number }>;
  /** Must add atomically: concurrent calls from several processes must never lose an increment. */
  add(workspaceId: string, day: string, tokens: number): Promise<void>;
}

/**
 * A store in this process's memory, for unit tests and the fake provider; never for an app. `limit` defaults to the
 * platform default, `AI_DAILY_TOKEN_BUDGET.default` in `@aivera/workspaces` (not imported: no module dependency here).
 */
export function memoryTokenBudget(limit = 2_000_000): TokenBudgetStore {
  const spent = new Map<string, number>();
  return {
    spentToday: async (workspaceId, day) => ({ spent: spent.get(`${workspaceId} ${day}`) ?? 0, limit }),
    add: async (workspaceId, day, tokens) =>
      void spent.set(`${workspaceId} ${day}`, (spent.get(`${workspaceId} ${day}`) ?? 0) + tokens),
  };
}

export type AiClient = ReturnType<typeof createAiClient>;

export function createAiClient(options: {
  provider: AiProvider;
  budget: TokenBudgetStore;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}) {
  const {
    provider,
    budget,
    now = Date.now,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = options;

  const breakers = new Map<Deployment, { failures: number; openUntil: number }>();
  const today = () => new Date(now()).toISOString().slice(0, 10); // the UTC day

  /** Runs one task with budget, breaker, timeout and retries, and records one span for it. */
  async function call<T>(
    operation: 'chat' | 'embeddings',
    task: string,
    settings: { deployment: Deployment; timeoutMs: number },
    workspaceId: string,
    attempt: (abortSignal: AbortSignal) => Promise<{ value: T; usage: Usage }>,
  ): Promise<T> {
    const { deployment } = settings;
    return withSpan(`ai ${operation} ${task}`, async () => {
      // Allowlisted keys only (packages/observability redact.ts); never a prompt or completion.
      annotateSpan({
        'aivera.ai.operation': operation,
        'aivera.ai.task': task,
        'aivera.ai.deployment': deployment,
        'workspace.id': workspaceId,
      });

      // A store that cannot be read or written fails the call closed: no unbudgeted model request, and the store's
      // error (which may quote SQL parameters) is dropped like a provider's.
      const day = today();
      const unbudgeted = (attempts: number): never => {
        outcome('unavailable', { 'aivera.ai.attempts': attempts, 'error.type': 'budget_store' });
        throw new AiUnavailable(task, 'budget store');
      };
      const { spent, limit } = await budget.spentToday(workspaceId, day).catch(() => unbudgeted(0));
      // Calls already in flight can overshoot the budget by their own size; it is a daily cap, not a meter. A budget
      // lowered below today's use stops the next call.
      if (spent >= limit) {
        outcome('budget_exceeded');
        throw new BudgetExceeded(task, workspaceId);
      }

      for (let attempts = 1; ; attempts++) {
        // One shared object per deployment, so concurrent calls add to the same count.
        let breaker = breakers.get(deployment);
        if (!breaker) breakers.set(deployment, (breaker = { failures: 0, openUntil: 0 }));
        if (breaker.openUntil > now()) {
          outcome('circuit_open', { 'aivera.ai.attempts': attempts - 1 });
          throw new AiUnavailable(task, 'circuit open');
        }
        let result: { value: T; usage: Usage };
        try {
          result = await attempt(AbortSignal.timeout(settings.timeoutMs));
        } catch (error) {
          const status = APICallError.isInstance(error) ? error.statusCode : undefined;
          const timedOut = error instanceof Error && error.name === 'TimeoutError';
          const reason = status ? `http ${status}` : timedOut ? 'timeout' : 'error';
          const transient = timedOut || (APICallError.isInstance(error) && error.isRetryable);
          // Any answer (a 4xx) means the service is up and resets the run. Once the open window ends the count stays
          // at the threshold, so one more transient failure reopens it (half-open).
          if (!transient) Object.assign(breaker, { failures: 0, openUntil: 0 });
          else if (++breaker.failures >= circuitBreaker.failures) breaker.openUntil = now() + circuitBreaker.openMs;
          if (!transient || attempts >= maxAttempts || breaker.openUntil > now()) {
            outcome('unavailable', { 'aivera.ai.attempts': attempts, 'error.type': reason });
            throw new AiUnavailable(task, reason);
          }
          // Azure sends retry-after-ms (and retry-after, seconds) on 429; otherwise back off 1 s, 2 s. Capped at 10 s.
          const headers = APICallError.isInstance(error) ? error.responseHeaders : undefined;
          const retryAfterMs = Number(headers?.['retry-after-ms'] ?? Number(headers?.['retry-after']) * 1000);
          await sleep(Math.min(retryAfterMs > 0 ? retryAfterMs : 1000 * 2 ** (attempts - 1), 10_000));
          continue;
        }
        Object.assign(breaker, { failures: 0, openUntil: 0 }); // in place: calls in flight hold this object
        const { value, usage } = result;
        // Charged to the day the call was checked against; only a successful call spends.
        await budget.add(workspaceId, day, usage.inputTokens + usage.outputTokens).catch(() => unbudgeted(attempts));
        const price = deployments[deployment];
        outcome('ok', {
          'aivera.ai.attempts': attempts,
          'gen_ai.usage.input_tokens': usage.inputTokens,
          'gen_ai.usage.output_tokens': usage.outputTokens,
          // Micro-dollars, not cents: one call costs a fraction of a cent. An estimate for dashboards, never billing.
          'aivera.ai.cost_usd_micros': Math.round(
            (usage.inputTokens * price.inputPerMillion + usage.outputTokens * price.outputPerMillion) / 1_000_000,
          ),
        });
        return value;
      }
    });
  }

  // Retries are ours (maxRetries: 0) so attempts are counted and the breaker sees each one. The SDK's own telemetry
  // stays off: it records prompts and completions.
  const sdk = { maxRetries: 0, telemetry: { isEnabled: false } } as const;

  return {
    /** Generates text for a named task. Structured output and citations: AIV-P0-028. */
    async generate(input: { task: GenerateTask; workspaceId: string; system?: string; prompt: string }): Promise<{
      text: string;
    }> {
      const settings = settingsOf(generateTasks, input.task);
      return call('chat', input.task, settings, input.workspaceId, async (abortSignal) => {
        const result = await generateText({
          ...sdk,
          model: provider.languageModel(settings.deployment),
          ...(input.system !== undefined && { system: input.system }),
          prompt: input.prompt,
          maxOutputTokens: settings.maxOutputTokens,
          temperature: settings.temperature,
          abortSignal,
        });
        const usage = { inputTokens: result.usage.inputTokens ?? 0, outputTokens: result.usage.outputTokens ?? 0 };
        return { value: { text: result.text }, usage };
      });
    },

    /** Embeds one text for a named task. Storage and search: AIV-P0-030. */
    async embed(input: { task: EmbedTask; workspaceId: string; value: string }): Promise<{ embedding: number[] }> {
      const settings = settingsOf(embedTasks, input.task);
      return call('embeddings', input.task, settings, input.workspaceId, async (abortSignal) => {
        const result = await sdkEmbed({
          ...sdk,
          model: provider.embeddingModel(settings.deployment),
          value: input.value,
          abortSignal,
        });
        return { value: { embedding: result.embedding }, usage: { inputTokens: result.usage.tokens, outputTokens: 0 } };
      });
    },
  };
}
