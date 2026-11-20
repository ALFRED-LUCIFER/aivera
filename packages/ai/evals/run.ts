import type { AiClient } from '../src/client.ts';
import { hardGates, taskThresholds } from './config.ts';
import { identifiersOf, verdict, type GoldenCase, type Verdict } from './golden.ts';
import { citationValidity, claimLabelling, contract, fieldMatch, safety, type Ratio } from './scorers.ts';

// Runs golden cases, scores them and applies the thresholds (AIV-P0-029).

/** Where a case's answer comes from: its recorded output, or the task's runner against a model. */
export type Answer = (task: string, golden: GoldenCase) => Promise<unknown>;
/** Judges an output against a rubric where exact match is not possible. */
export type Judge = (rubric: string, golden: GoldenCase, output: unknown) => Promise<Verdict>;

const metrics = ['citationValidity', 'contract', 'claimLabelling', 'fieldMatch', 'safety', 'judge'] as const;
type Metric = (typeof metrics)[number];

type CaseResult = { id: string; passed: boolean; error?: string; scores: Partial<Record<Metric, Ratio>> };
export type TaskReport = {
  task: string;
  passed: boolean;
  cases: CaseResult[];
  /** Pooled across the task's cases; null when no case had anything to score. */
  rates: Record<Metric, number | null>;
  thresholds: Record<Metric, number>;
  /** Per case group: cases passed of the group's cases (failures are their ids), against the group's minimum. */
  groups: (Ratio & { label: string; min: number })[];
};

export const recordedAnswer: Answer = async (_task, golden) => golden.recorded.output;
export const recordedJudge: Judge = async (_rubric, golden) => {
  if (!golden.recorded.judge) throw new Error('no recorded verdict');
  return golden.recorded.judge;
};

/** The judge's prompt, versioned in code (ADR-006). It sees the rubric, the synthetic sources and the output only. */
export const judgePrompt = {
  id: 'evals.judge@2',
  system:
    'You grade one AI output for Credalent, a hiring tool, against a rubric. Read the rubric, the output and the ' +
    'sources the output was given. Pass only if the output meets every point of the rubric; the reason names the ' +
    'point it fails or confirms in one sentence.',
};

// A fixed synthetic workspace: the live run's budget is counted apart from any real workspace.
export const evalWorkspaceId = '0190d4a2-0000-7000-8000-0000000e7a1e';

/**
 * The LLM judge on the `evals.judge` task, through the structured-output contract: a verdict that is not the schema
 * fails with SchemaMismatch, never patched (AGENTS.md 3.7).
 */
export function liveJudge(ai: AiClient): Judge {
  return async (rubric, golden, output) =>
    ai.generateStructured({
      task: 'evals.judge',
      workspaceId: evalWorkspaceId,
      promptVersion: judgePrompt.id,
      system: judgePrompt.system,
      prompt: JSON.stringify({ rubric, output }),
      schema: verdict,
      sources: golden.sources,
      // The judge reads the sources as the task's model did.
      identifiers: identifiersOf(golden),
    });
}

async function scoreCase(task: string, golden: GoldenCase, answer: Answer, judge: Judge): Promise<CaseResult> {
  const { expected, sources } = golden;
  const { statements: statementPaths } = taskThresholds[task] ?? { statements: [] };
  try {
    const output = await answer(task, golden);
    const scores: CaseResult['scores'] = {
      citationValidity: citationValidity(output, sources, statementPaths),
      contract: contract(task, output, sources),
      claimLabelling: claimLabelling(output, sources, statementPaths),
    };
    if (expected.match) scores.fieldMatch = fieldMatch(output, expected.match);
    if (expected.safety) scores.safety = safety(output, expected.safety);
    if (expected.judge) {
      const { pass, reason } = await judge(expected.judge, golden, output);
      scores.judge = { n: pass ? 1 : 0, total: 1, failures: pass ? [] : [`judge: ${reason}`] };
    }
    const threshold = thresholdsOf(task);
    const passed = metrics.every((metric) => {
      const score = scores[metric];
      return !score || score.total === 0 || score.n / score.total >= threshold[metric];
    });
    return { id: golden.id, passed, scores };
  } catch (error) {
    // The error's name and message only: a provider's error can repeat the prompt (AGENTS.md 1.2).
    return { id: golden.id, passed: false, error: error instanceof Error ? error.name : 'error', scores: {} };
  }
}

function thresholdsOf(task: string): Record<Metric, number> {
  const own = taskThresholds[task];
  if (!own) throw new Error(`No thresholds for task ${task} in evals/config.ts`);
  return { ...hardGates, fieldMatch: own.fieldMatch, judge: own.judge };
}

export async function evaluateTask(
  task: string,
  cases: GoldenCase[],
  answer: Answer,
  judge: Judge,
): Promise<TaskReport> {
  const thresholds = thresholdsOf(task);
  const results: CaseResult[] = [];
  for (const golden of cases) results.push(await scoreCase(task, golden, answer, judge)); // one call at a time
  const rates = Object.fromEntries(
    metrics.map((metric) => {
      const scored = results.flatMap((result) => result.scores[metric] ?? []);
      const total = scored.reduce((sum, score) => sum + score.total, 0);
      return [metric, total === 0 ? null : scored.reduce((sum, score) => sum + score.n, 0) / total];
    }),
  ) as Record<Metric, number | null>;
  const groupThresholds = taskThresholds[task]?.groups ?? {};
  const groups = Object.entries(groupThresholds).map(([group, { label, min }]) => {
    const inGroup = results.filter((_, i) => cases[i]?.group === group);
    const failures = inGroup.filter((result) => !result.passed).map((result) => result.id);
    return { label, min, n: inGroup.length - failures.length, total: inGroup.length, failures };
  });
  const passed =
    results.every((result) => !result.error) &&
    metrics.every((metric) => rates[metric] === null || (rates[metric] ?? 0) >= thresholds[metric]) &&
    // shortcut: an empty group passes (the failing fixtures fill one group only); eval.test.ts pins each group's case
    // count in the golden set. Upgrade to a per-group minimum count if a group can shrink outside that test.
    groups.every((group) => group.total === 0 || group.n / group.total >= group.min);
  return { task, passed, cases: results, rates, thresholds, groups };
}

const labels: Record<Metric, string> = {
  citationValidity: 'Citation validity',
  contract: 'Citation contract',
  claimLabelling: 'Claim labelling',
  fieldMatch: 'Field match',
  safety: 'Safety',
  judge: 'Judge',
};

const percent = (rate: number) => `${Math.floor(rate * 1000) / 10}%`;

const groupLine = (task: string, group: TaskReport['groups'][number]) =>
  `${task} ${group.label}: ${group.total ? percent(group.n / group.total) : 'n/a'} (${group.n}/${group.total}, min ${percent(group.min)})`;

/** One line per case: result, each score, and what failed; then one line per case group. */
export function caseLines(report: TaskReport): string[] {
  const cases = report.cases.flatMap((result) => {
    const scores = metrics
      .flatMap((metric) => {
        const score = result.scores[metric];
        return score && score.total > 0 ? [`${labels[metric].toLowerCase()} ${score.n}/${score.total}`] : [];
      })
      .join(', ');
    const head = `${result.passed ? 'PASS' : 'FAIL'} ${report.task} ${result.id}`;
    const failures = Object.values(result.scores).flatMap((score) => score.failures);
    return [
      result.error ? `${head}: error ${result.error}` : `${head}: ${scores}`,
      ...failures.map((failure) => `    ${failure}`),
    ];
  });
  return [...cases, ...report.groups.map((group) => groupLine(report.task, group))];
}

/** The summary as a Markdown table: each rate against its threshold, and the failing cases by id. */
export function summaryTable(reports: TaskReport[]): string {
  const rows = reports.map((report) => {
    const cells = metrics.map((metric) => {
      const rate = report.rates[metric];
      return rate === null ? 'n/a' : `${percent(rate)} (min ${percent(report.thresholds[metric])})`;
    });
    const failing = report.cases.filter((result) => !result.passed).map((result) => result.id);
    const result = report.passed ? 'pass' : `**fail**${failing.length ? `: ${failing.join(', ')}` : ''}`;
    return `| ${report.task} | ${report.cases.length} | ${cells.join(' | ')} | ${result} |`;
  });
  return [
    `| Task | Cases | ${metrics.map((metric) => labels[metric]).join(' | ')} | Result |`,
    `| --- | --: | ${metrics.map(() => '--:').join(' | ')} | --- |`,
    ...rows,
    ...reports.flatMap((report) => report.groups.map((group) => `\n${groupLine(report.task, group)}`)),
  ].join('\n');
}
