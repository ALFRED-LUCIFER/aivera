// The eval gate on a catalogue draft (AIV-P2-048, ADR-013 point 12): a run counts only for the draft content it ran on.
// Pure: no database, no clock (the caller passes `now`).
import { z } from 'zod';
import type { CatalogueVersion } from './catalogue.ts';

export const EVAL_RUN_STATUSES = ['running', 'passed', 'failed', 'error'] as const;
export type EvalRunStatus = (typeof EVAL_RUN_STATUSES)[number];

/**
 * A run still `running` this long after it was asked for is taken as lost (its worker message dead-lettered or never
 * sent): the page says it could not run, and a new run may start.
 */
export const EVAL_RUN_TIMEOUT_MS = 30 * 60_000;

/** The platform eval budget per UTC day, across every run (ADR-013 point 12); each run is also capped at liveTokenCap. */
export const EVAL_DAILY_TOKEN_CAP = 1_500_000;

/** What a finished run found, stored with it: per task its rates and failed case ids, and pack keys with no golden case. */
export const evalResultSchema = z.strictObject({
  uncovered: z.array(z.string()),
  tasks: z.array(
    z.strictObject({
      task: z.string(),
      passed: z.boolean(),
      fieldMatch: z.number().min(0).max(1).nullable(),
      groups: z.array(z.strictObject({ group: z.string(), n: z.int().min(0), total: z.int().min(0) })),
      failedCases: z.array(z.string()),
    }),
  ),
});
export type EvalResult = z.infer<typeof evalResultSchema>;

/** A run as stored: for which draft content (`contentHash`), its status and, once finished, its result. */
export type EvalRun = {
  readonly id: string;
  /** Null once its draft is discarded (AIV-P2-049). */
  readonly version: number | null;
  readonly contentHash: string;
  readonly status: EvalRunStatus;
  readonly requestedAt: Date;
  readonly finishedAt: Date | null;
  readonly tokens: number;
  readonly result: EvalResult | null;
};

/**
 * The draft's eval state for the editor and the console home. `passed` only for the latest run, finished and passed, on
 * the draft's current content; publish (AIV-P2-049) requires exactly that (`evalAllowsPublish`).
 */
export type DraftEval =
  | { readonly status: 'not_run' }
  | { readonly status: 'running'; readonly requestedAt: Date }
  | { readonly status: 'error'; readonly requestedAt: Date }
  | { readonly status: 'stale'; readonly finishedAt: Date | null }
  | {
      readonly status: 'passed' | 'failed';
      readonly finishedAt: Date;
      readonly tokens: number;
      readonly result: EvalResult;
    };

/** "Run the eval": names the draft and the revision the page showed, like every save. */
export const evalRequestSchema = z.strictObject({ version: z.int().min(1), revision: z.int().min(0) });
export type EvalRequestInput = z.infer<typeof evalRequestSchema>;

/** The keys the run sends to `jobs.detectDomain`: the draft's packs and regions not retired, as detect-domain.ts does. */
export const evalKeys = ({ packs, regions }: Pick<CatalogueVersion, 'packs' | 'regions'>) => ({
  domains: packs.filter((p) => !p.retired).map((p) => p.key),
  regions: regions.filter((r) => !r.retired).map((r) => r.key),
});

const lost = (run: EvalRun, now: Date) => now.getTime() - run.requestedAt.getTime() >= EVAL_RUN_TIMEOUT_MS;

/** Whether `run` blocks a new one: still running and not yet lost. */
export const isRunning = (run: EvalRun | null, now: Date) => run?.status === 'running' && !lost(run, now);

/** The draft's eval state from its latest run (by request time) and its current content hash. */
export function draftEvalState(currentHash: string, run: EvalRun | null, now: Date): DraftEval {
  if (!run) return { status: 'not_run' };
  if (run.status === 'running') return { status: lost(run, now) ? 'error' : 'running', requestedAt: run.requestedAt };
  // A run on other content never counts, whatever it found.
  if (run.contentHash !== currentHash) return { status: 'stale', finishedAt: run.finishedAt };
  if (run.status === 'error' || !run.finishedAt || !run.result)
    return { status: 'error', requestedAt: run.requestedAt };
  return { status: run.status, finishedAt: run.finishedAt, tokens: run.tokens, result: run.result };
}

/** The publish gate (AIV-P2-049): a passed eval on the draft's current content, nothing else. */
export const evalAllowsPublish = (state: DraftEval | null) => state?.status === 'passed';
