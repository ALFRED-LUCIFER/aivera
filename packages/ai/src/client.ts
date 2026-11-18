import { annotateSpan, withSpan } from '@aivera/observability';
import { APICallError, embed as sdkEmbed, generateText } from 'ai';
import {
  circuitBreaker,
  dailyTokenBudgetPerWorkspace,
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

export type AiClient = ReturnType<typeof createAiClient>;

export function createAiClient(options: {
  provider: AiProvider;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}) {
  const { provider, now = Date.now, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = options;

  const breakers = new Map<Deployment, { failures: number; openUntil: number }>();
  // shortcut: the budget is counted in this process's memory, so web and worker each allow the full budget and a
  // restart resets it; move it to a workspace-scoped table with RLS when the worker makes AI calls (AIV-P0-015, #47)
  let budgetDay = '';
  const spent = new Map<string, number>();
  const spentToday = (workspaceId: string) => {
    const today = new Date(now()).toISOString().slice(0, 10);
    if (today !== budgetDay) {
      budgetDay = today;
      spent.clear();
    }
    return spent.get(workspaceId) ?? 0;
  };

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

      // Calls already in flight can overshoot the budget by their own size; it is a daily cap, not a meter.
      if (spentToday(workspaceId) >= dailyTokenBudgetPerWorkspace) {
        outcome('budget_exceeded');
        throw new BudgetExceeded(task, workspaceId);
      }

      for (let attempts = 1; ; attempts++) {
        const breaker = breakers.get(deployment) ?? { failures: 0, openUntil: 0 };
        if (breaker.openUntil > now()) {
          outcome('circuit_open', { 'aivera.ai.attempts': attempts - 1 });
          throw new AiUnavailable(task, 'circuit open');
        }
        try {
          const { value, usage } = await attempt(AbortSignal.timeout(settings.timeoutMs));
          breakers.delete(deployment);
          spent.set(workspaceId, spentToday(workspaceId) + usage.inputTokens + usage.outputTokens);
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
        } catch (error) {
          const status = APICallError.isInstance(error) ? error.statusCode : undefined;
          const timedOut = error instanceof Error && error.name === 'TimeoutError';
          const reason = status ? `http ${status}` : timedOut ? 'timeout' : 'error';
          const transient = timedOut || (APICallError.isInstance(error) && error.isRetryable);
          if (transient) {
            breaker.failures += 1;
            if (breaker.failures >= circuitBreaker.failures) breaker.openUntil = now() + circuitBreaker.openMs;
            breakers.set(deployment, breaker);
          }
          if (!transient || attempts >= maxAttempts || breaker.openUntil > now()) {
            outcome('unavailable', { 'aivera.ai.attempts': attempts, 'error.type': reason });
            throw new AiUnavailable(task, reason);
          }
          // Azure sends Retry-After on 429; otherwise back off 1 s, 2 s. Capped so a caller is not held for a minute.
          const retryAfter = APICallError.isInstance(error) ? Number(error.responseHeaders?.['retry-after']) : NaN;
          await sleep(Math.min(Number.isFinite(retryAfter) ? retryAfter * 1000 : 1000 * 2 ** (attempts - 1), 10_000));
        }
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
