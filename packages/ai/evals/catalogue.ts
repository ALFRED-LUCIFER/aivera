import type { AiClient, TokenBudgetStore } from '../src/client.ts';
import { detectDomainRunner, liveTokenCap, runners, type Runner } from './config.ts';
import { loadGolden, type GoldenCase } from './golden.ts';
import {
  evalWorkspaceId,
  evaluateTask,
  liveJudge,
  liveMatcher,
  liveSuggestionJudge,
  matchPrompt,
  suggestionPrompt,
} from './run.ts';

// The live eval of a catalogue draft (AIV-P2-048, ADR-013 point 12): the jobs.detectDomain and jobs.draftCompetencies
// golden sets under the thresholds of config.ts, the draft's keys as data. Inputs are the synthetic golden cases only,
// never a workspace's job or a candidate (AGENTS.md 1.1).

/** The pack and region keys a draft offers (not retired), as the jobs module sends them to `jobs.detectDomain`. */
export type CatalogueKeys = { domains: string[]; regions: string[] };

export type CatalogueEvalTask = {
  task: string;
  passed: boolean;
  /** Pooled across the task's cases; null when nothing was scored. */
  fieldMatch: number | null;
  /** Per case group (config.ts): cases that passed every metric of the group's cases. */
  groups: { group: string; n: number; total: number }[];
  failedCases: string[];
};

/**
 * `unavailable`: the AI deployment did not answer (or the eval budget ran out), so the run says nothing about the draft.
 * `uncovered`: the draft's pack and region keys with no golden case; a run with any fails before a model call.
 */
export type CatalogueEvalResult = {
  outcome: 'passed' | 'failed' | 'unavailable';
  uncovered: string[];
  tasks: CatalogueEvalTask[];
};

const TASKS = ['jobs.detectDomain', 'jobs.draftCompetencies'] as const;
const UNAVAILABLE = new Set(['AiUnavailable', 'BudgetExceeded']);

/**
 * The pack and region keys no `jobs.detectDomain` golden case expects (as its industry, or among its regions): each
 * needs golden cases in code first (AIV-P2-048 for packs, AIV-P2-059 for regions).
 */
export const uncoveredKeys = ({ domains, regions }: CatalogueKeys, cases: readonly GoldenCase[]): string[] => {
  const domainsCovered = new Set(cases.map((c) => c.expected.match?.['industry.domain']));
  const regionsCovered = new Set(cases.flatMap((c) => [c.expected.match?.['regions[*].region'] ?? []].flat()));
  return [...domains.filter((d) => !domainsCovered.has(d)), ...regions.filter((r) => !regionsCovered.has(r))];
};

/**
 * shortcut: only the pack and region keys reach the model (as detect-domain.ts sends them); jobs.draftCompetencies takes
 * no catalogue data, so label and competency edits cannot change a result: the gate tells only for packs or regions
 * added, retired or renamed. Pass the draft's pack competencies in the requests once the prompts use them.
 *
 * Runs the draft's eval with `ai`, one call at a time. `dir` is the golden set (tests pass their own). */
export async function evaluateCatalogue(
  ai: Pick<AiClient, 'generateStructured'>,
  { domains: [domain, ...domains], regions: [region, ...regions] }: CatalogueKeys,
  dir = import.meta.dirname,
): Promise<CatalogueEvalResult> {
  const golden = loadGolden(dir);
  // A catalogue with no pack or no region offers nothing to detect against (detect-domain.ts makes no call either).
  if (!domain || !region) return { outcome: 'failed', uncovered: [], tasks: [] };
  const catalogue = { domains: [domain, ...domains], regions: [region, ...regions] } satisfies Parameters<
    typeof detectDomainRunner
  >[0];
  const uncovered = uncoveredKeys(catalogue, golden.get('jobs.detectDomain') ?? []);
  if (uncovered.length > 0) return { outcome: 'failed', uncovered, tasks: [] };

  const run: Record<string, Runner | undefined> = { ...runners, 'jobs.detectDomain': detectDomainRunner(catalogue) };
  const judge = liveJudge(ai);
  const tasks: CatalogueEvalTask[] = [];
  let unavailable = false;
  for (const task of TASKS) {
    const cases = golden.get(task);
    const runner = run[task];
    if (!cases?.length || !runner) throw new Error(`No golden cases or runner for ${task}`);
    const report = await evaluateTask(
      task,
      cases,
      (_task, c) => runner(ai, c, evalWorkspaceId),
      judge,
      liveMatcher(ai),
      liveSuggestionJudge(ai),
    );
    unavailable ||= report.cases.some((c) => c.error !== undefined && UNAVAILABLE.has(c.error));
    tasks.push({
      task,
      passed: report.passed,
      fieldMatch: report.rates.fieldMatch,
      groups: report.groups.map(({ group, n, total }) => ({ group, n, total })),
      failedCases: report.cases.filter((c) => !c.passed).map((c) => c.id),
    });
  }
  const outcome = unavailable ? 'unavailable' : tasks.every((t) => t.passed) ? 'passed' : 'failed';
  return { outcome, uncovered, tasks };
}

/**
 * Its own store, not the workspaces one: that table's rows belong to a workspace by foreign key (ADR-013 point 12).
 * The run's token budget: at most `liveTokenCap`, and no more than the platform eval budget has left today
 * (`tokensLeftToday`), counted apart from every workspace's (ADR-013 point 12). `used()` is what the run spent.
 */
export function runBudget(tokensLeftToday: number): TokenBudgetStore & { used(): number } {
  const limit = Math.max(0, Math.min(liveTokenCap, tokensLeftToday));
  let used = 0;
  return {
    spentToday: async () => ({ spent: used, limit }),
    add: async (_workspaceId, _day, tokens) => void (used += tokens),
    used: () => used,
  };
}

/**
 * A test helper on the production export, so the jobs integration suite can drive the worker job without a model.
 * A client whose answers are the golden cases' recorded ones (and recorded judge verdicts), for tests: no model call.
 * `answer` may replace a case's output, to model a draft that answers worse.
 */
export function recordedClient(
  dir = import.meta.dirname,
  answer: (golden: GoldenCase, task: string) => unknown = (golden) => golden.recorded.output,
): Pick<AiClient, 'generateStructured'> {
  // A case is found by its task and sources; a judge request by the case's rubric and sources.
  const cases = new Map<string, { task: string; golden: GoldenCase }>();
  // A matcher request names no case: answer each miss with a recorded verdict that is one of its options.
  const verdicts = new Map<string, (string | null)[]>();
  for (const [task, list] of loadGolden(dir))
    for (const golden of list) {
      for (const [expected, match] of Object.entries(golden.recorded.matches ?? {}))
        verdicts.set(expected, [...(verdicts.get(expected) ?? []), match]);
      cases.set(JSON.stringify([task, golden.sources]), { task, golden });
      if (golden.expected.judge) cases.set(JSON.stringify([golden.expected.judge, golden.sources]), { task, golden });
    }
  const generateStructured = async (request: {
    task: string;
    promptVersion: string;
    prompt: string;
    sources: readonly unknown[];
  }) => {
    if (request.promptVersion === matchPrompt.id) {
      const misses = JSON.parse(request.prompt) as Record<string, { expected: string; candidates: string[] }>;
      return Object.fromEntries(
        Object.entries(misses).map(([k, m]) => {
          const match = verdicts.get(m.expected)?.find((v): v is string => v !== null && m.candidates.includes(v));
          return [k, match ?? null];
        }),
      );
    }
    if (request.promptVersion === suggestionPrompt.id) {
      const recorded = cases.get(JSON.stringify(['jobs.draftCompetencies', request.sources]))?.golden.recorded
        .suggestions?.verdicts;
      if (!recorded) throw new Error('no recorded suggestion verdicts for this request');
      return {
        verdicts: Object.entries(recorded).map(([name, fault]) => ({
          name,
          pointsTo: '',
          closestListed: '',
          sameWorkAsClosest: fault === 'listed',
          aboutThePerson: fault === 'proxy',
          softSkillAnyJobAsks: fault === 'generic',
          implied: fault !== 'unrelated',
          citedLineImplies: fault !== 'citation',
        })),
      };
    }
    const judged = request.task === 'evals.judge';
    const key = judged ? (JSON.parse(request.prompt) as { rubric: string }).rubric : request.task;
    const found = cases.get(JSON.stringify([key, request.sources]));
    if (!found) throw new Error('no golden case for this request');
    return judged ? found.golden.recorded.judge : answer(found.golden, found.task);
  };
  return { generateStructured: generateStructured as AiClient['generateStructured'] };
}
