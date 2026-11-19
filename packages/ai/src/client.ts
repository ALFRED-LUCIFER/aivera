import { annotateSpan, withSpan } from '@aivera/observability';
import { APICallError, embed as sdkEmbed, generateText, Output } from 'ai';
import type { z } from 'zod';
import { checkOutput, formatSources, type Checked, type Source } from './citations';
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

// Appended to every structured task's system prompt; bump the version with any change (it is on telemetry).
const CITATION_RULES_VERSION = 'citations@1';
const CITATION_RULES = [
  'Answer only from the sources in the prompt, each marked <source id="S1" kind="...">.',
  'Every item that has a citations field must cite at least one source: its id (such as S1) and a quote copied',
  'word for word from that source. Never cite a source that is not listed and never reword a quote.',
  'If the sources do not support an item, leave the item out.',
].join(' ');

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
    /**
     * Generates zod-validated output for a named task under the citation contract (AIV-P0-028). `sources` are shown to
     * the model as S1, S2, ...; every `cited()` statement must quote one of them verbatim. Output that fails the schema
     * or the contract is rejected, never patched, and asked for once more; then the call throws `SchemaMismatch`,
     * `UncitedOutput` or `InvalidCitation`. Each attempt is charged to the workspace's budget. There is no free-text
     * call: anything that feeds the product is structured (ADR-006 point 3). Azure sends the schema in strict mode,
     * which needs every property present: use `.nullable()` or a union, never `.optional()`.
     */
    async generateStructured<S extends z.ZodType>(input: {
      task: GenerateTask;
      workspaceId: string;
      /** The caller's prompt id and version, `jobs.draftCompetencies@1`; it goes on telemetry, so never free text. */
      promptVersion: string;
      system: string;
      prompt: string;
      schema: S;
      sources: readonly Source[];
    }): Promise<Checked<z.infer<S>>> {
      const { task, schema, sources } = input;
      const settings = settingsOf(generateTasks, task);
      if (!/^[a-z][\w.-]{0,63}@\d{1,4}$/i.test(input.promptVersion))
        throw new Error('promptVersion must look like jobs.draftCompetencies@1');
      // The model is given the schema; we parse its text ourselves, so a mismatch and an uncited answer are told apart.
      const output = { ...Output.object({ schema }), parseCompleteOutput: async ({ text }: { text: string }) => text };
      return withSpan(`ai structured ${task}`, async () => {
        annotateSpan({
          'aivera.ai.task': task,
          'aivera.ai.template_version': `${input.promptVersion}+${CITATION_RULES_VERSION}`,
          'workspace.id': input.workspaceId,
        });
        for (let attempts = 1; ; attempts++) {
          const text = await call('chat', task, settings, input.workspaceId, async (abortSignal) => {
            const result = await generateText({
              ...sdk,
              model: provider.languageModel(settings.deployment),
              system: `${input.system}\n\n${CITATION_RULES}`,
              prompt: `${input.prompt}\n\nSources:\n${formatSources(sources)}`,
              output,
              maxOutputTokens: settings.maxOutputTokens,
              temperature: settings.temperature,
              abortSignal,
            });
            const usage = { inputTokens: result.usage.inputTokens ?? 0, outputTokens: result.usage.outputTokens ?? 0 };
            return { value: result.text, usage };
          });
          try {
            const value = checkOutput(task, text, schema, sources);
            outcome('ok', { 'aivera.ai.attempts': attempts });
            return value;
          } catch (error) {
            // checkOutput throws only the contract's three errors, whose messages hold no output.
            outcome('rejected', { 'aivera.ai.attempts': attempts, 'error.type': (error as Error).name });
            if (attempts >= 2) throw error;
          }
        }
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
