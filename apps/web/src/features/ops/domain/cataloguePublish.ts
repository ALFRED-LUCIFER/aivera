// Publishing or discarding the catalogue draft at /ops/catalogue (AIV-P2-049, ADR-013 point 13). Pure (ADR-003). The
// server checks the same gate again on the locked draft; this only decides what the card shows.
import type { CatalogueChange } from '@credalent/jobs';
import type { Refusal } from './catalogueEditor.ts';
import type { EvalView } from './catalogueEval.ts';

/** The shortest reason a publish takes, as `publishDraftSchema` and the database check have it. */
export const REASON_MIN = 10;

/** Why "Publish version N" is disabled, by message key; null when it may be confirmed. */
export type PublishBlock =
  'noChanges' | 'evalNotRun' | 'evalRunning' | 'evalFailed' | 'evalStale' | 'evalError' | 'reason';

const EVAL_BLOCKS: Record<Exclude<EvalView['status'], 'passed'>, PublishBlock> = {
  not_run: 'evalNotRun',
  running: 'evalRunning',
  failed: 'evalFailed',
  stale: 'evalStale',
  error: 'evalError',
};

/** The first thing that blocks a publish: no change, then the eval on the draft's current content, then the reason. */
export function publishBlock(
  changes: readonly CatalogueChange[],
  evaluation: EvalView,
  reason: string,
): PublishBlock | null {
  if (changes.length === 0) return 'noChanges';
  if (evaluation.status !== 'passed') return EVAL_BLOCKS[evaluation.status];
  return reason.trim().length < REASON_MIN ? 'reason' : null;
}

/** The publish and discard cards' view model. */
export type CataloguePublishViewModel = {
  version: number;
  publishedVersion: number;
  changes: readonly CatalogueChange[];
  publish: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    reason: string;
    onReasonChange: (reason: string) => void;
    block: PublishBlock | null;
    /** The last refusal, for the card's error message. */
    error: Refusal | null;
    onConfirm: () => Promise<void>;
  };
  discard: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    error: Refusal | null;
    onConfirm: () => Promise<void>;
  };
};
