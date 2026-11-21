import { CatalogueError } from '../domain/catalogue-draft.ts';
import {
  draftEvalState,
  EVAL_DAILY_TOKEN_CAP,
  evalKeys,
  evalRequestSchema,
  isRunning,
  type DraftEval,
  type EvalRequestInput,
  type EvalResult,
  type EvalRun,
  type EvalRunStatus,
} from '../domain/catalogue-eval.ts';
import { contentHash } from '../domain/catalogue-hash.ts';
import { begin, type DraftStore } from './catalogue-editor.ts';

// The eval on a catalogue draft (AIV-P2-048, ADR-013 point 12): an operator asks for a run, a worker job runs the golden
// sets with the draft's keys and records the result against the draft's content hash.

/** The pack and region keys a run sends to the model, fixed when it is asked for. */
export type EvalKeys = { domains: string[]; regions: string[] };

export type EvalStore = Pick<DraftStore, 'lockDraft' | 'read' | 'recordPlatform'> & {
  /** The draft version's latest run by request time, or null. */
  latestRun(version: number): Promise<EvalRun | null>;
  startRun(run: {
    id: string;
    version: number;
    contentHash: string;
    keys: EvalKeys;
    requestedBy: string;
    requestedAt: Date;
  }): Promise<void>;
  /**
   * Ends a lost run (`running` past its timeout) as `error`, so a new run may start. False when a worker still holds
   * it (its row is locked): it is not lost after all.
   */
  abandonRun(id: string, at: Date): Promise<boolean>;
  /** Writes `CatalogueEvalRequested.v1` for the run to the outbox, in this transaction. */
  enqueueRun(id: string, at: Date): Promise<void>;
};

export type CatalogueEvalPorts = {
  inTransaction<T>(work: (store: EvalStore) => Promise<T>): Promise<T>;
  inSnapshot<T>(work: (store: EvalStore) => Promise<T>): Promise<T>;
  newId: () => string;
  now: () => Date;
};

export function catalogueEval({ inTransaction, inSnapshot, newId, now }: CatalogueEvalPorts) {
  return {
    /**
     * Starts a run on the draft as the page showed it (`stale` otherwise) and queues its worker job. Refused while
     * another run on the draft is running (`eval_running`). Audited `catalogue.eval_requested`, last.
     */
    requestEval: async (operatorId: string, raw: EvalRequestInput): Promise<void> => {
      const input = evalRequestSchema.parse(raw);
      return inTransaction(async (store) => {
        const { draft, version } = await begin(store, input);
        const at = now();
        const latest = await store.latestRun(version);
        if (isRunning(latest, at)) throw new CatalogueError('eval_running');
        if (latest?.status === 'running' && !(await store.abandonRun(latest.id, at)))
          throw new CatalogueError('eval_running');
        const id = newId();
        await store.startRun({
          id,
          version,
          contentHash: contentHash(draft),
          keys: evalKeys(draft),
          requestedBy: operatorId,
          requestedAt: at,
        });
        await store.enqueueRun(id, at);
        await store.recordPlatform({
          actorId: operatorId,
          action: 'catalogue.eval_requested',
          after: { catalogueVersion: version, revision: draft.revision },
        });
      });
    },

    /** The open draft's eval state, or null when no draft is open. */
    getDraftEval: (): Promise<DraftEval | null> =>
      inSnapshot(async (store) => {
        const { draft } = await store.read();
        if (!draft) return null;
        return draftEvalState(contentHash(draft), await store.latestRun(draft.version), now());
      }),
  };
}

/** What the worker's eval found, and the tokens it spent. */
export type EvalOutcome = EvalResult & { outcome: 'passed' | 'failed' | 'unavailable'; tokens: number };

/** The worker job's view of one transaction. */
export type RunStore = {
  /** The run with its keys, locked for this transaction; null when there is none. */
  lockRun(id: string): Promise<(EvalRun & { keys: EvalKeys }) | null>;
  /** Tokens every run finished on this UTC day (`YYYY-MM-DD`) spent: the platform eval budget's use. */
  tokensOn(day: string): Promise<number>;
  finishRun(
    id: string,
    end: { status: Exclude<EvalRunStatus, 'running'>; result: EvalResult | null; tokens: number; finishedAt: Date },
  ): Promise<void>;
};

/**
 * The worker job (AIV-P2-048): runs the eval for a run still `running` and records its end once. A redelivered message
 * for a finished run does nothing. An unavailable model ends the run as `error` ("could not run"); the draft is never
 * touched. Returns how the run ended, or null when there was nothing to do.
 */
export async function runDraftEval(
  store: RunStore,
  runId: string,
  { evaluate, now }: { evaluate: (keys: EvalKeys, tokensLeftToday: number) => Promise<EvalOutcome>; now: () => Date },
): Promise<{
  version: number | null;
  status: Exclude<EvalRunStatus, 'running'>;
  tokens: number;
  failed: number;
} | null> {
  const run = await store.lockRun(runId);
  if (run?.status !== 'running') return null;
  const spent = await store.tokensOn(now().toISOString().slice(0, 10));
  // shortcut: the whole eval runs in the consumer transaction, holding the run row (minutes; Service Bus renews the
  // message lock for 5 minutes), and tokens spent by an attempt that throws before finishRun are not counted, so each of
  // up to 10 deliveries can spend liveTokenCap. Split request, run and record into their own transactions, with the
  // spend saved per call, if a live run nears the lock renewal or retries show in the token use.
  const { outcome, tokens, ...result } = await evaluate(run.keys, EVAL_DAILY_TOKEN_CAP - spent);
  const status = outcome === 'unavailable' ? 'error' : outcome;
  await store.finishRun(runId, { status, result: status === 'error' ? null : result, tokens, finishedAt: now() });
  const failed = result.tasks.reduce((sum, task) => sum + task.failedCases.length, 0);
  return { version: run.version, status, tokens, failed };
}
