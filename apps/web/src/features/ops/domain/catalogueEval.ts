// The eval on the catalogue draft at /ops/catalogue (AIV-P2-048, ADR-013 point 12): what the page shows of the draft's
// eval state. Pure (ADR-003). The state and its rules are the jobs module's.
import { evalRequestSchema, type DraftEval } from '@credalent/jobs';
import type { Refusal } from './catalogueEditor.ts';

export { evalRequestSchema };

/** A rate the run observed: a group's cases passed of its cases, or a task's pooled field match. */
export type EvalMetric = { key: 'domain' | 'none' | 'fairness' | 'fieldMatch'; percent: number };

export type EvalView =
  | { status: 'not_run' | 'running' | 'error' | 'stale' }
  | {
      status: 'passed' | 'failed';
      finishedAt: Date;
      tasks: { task: EvalTask; metrics: EvalMetric[] }[];
      failedCases: string[];
      /** New pack keys with no golden case: the run failed before any model call. */
      uncovered: string[];
    };

/** The tasks a catalogue eval runs, by their message key (task ids hold a dot, which message keys cannot). */
export type EvalTask = 'detectDomain' | 'draftCompetencies';
const TASKS: Record<string, EvalTask> = {
  'jobs.detectDomain': 'detectDomain',
  'jobs.draftCompetencies': 'draftCompetencies',
};
const METRIC_KEYS: readonly string[] = ['domain', 'none', 'fairness'];
const percent = (ratio: number) => Math.floor(ratio * 1000) / 10;

/** The draft's eval as the page shows it; null when no draft is open. */
export function evalView(state: DraftEval | null): EvalView | null {
  if (!state) return null;
  if (state.status !== 'passed' && state.status !== 'failed') return { status: state.status };
  const { tasks, uncovered } = state.result;
  return {
    status: state.status,
    finishedAt: state.finishedAt,
    tasks: tasks.flatMap(({ task, groups, fieldMatch }) => {
      const key = TASKS[task];
      if (!key) return [];
      return [
        {
          task: key,
          metrics: [
            ...groups.flatMap(({ group, n, total }) =>
              METRIC_KEYS.includes(group) && total > 0
                ? [{ key: group as EvalMetric['key'], percent: percent(n / total) }]
                : [],
            ),
            // A task with case groups is read by them; one without, by its field match.
            ...(groups.length === 0 && fieldMatch !== null
              ? [{ key: 'fieldMatch' as const, percent: percent(fieldMatch) }]
              : []),
          ],
        },
      ];
    }),
    failedCases: tasks.flatMap((t) => t.failedCases),
    uncovered,
  };
}

/** While a run is running, the page reloads its state this often. */
export const EVAL_POLL_MS = 5_000;

/** The eval panel's view model: the state, a request in flight, its refusal, and "Run the eval". */
export type CatalogueEvalViewModel = {
  view: EvalView;
  pending: boolean;
  error: Refusal | null;
  onRun: () => Promise<void>;
};
