import type { AiClient } from '../src/client.ts';
import { hardGates, taskThresholds } from './config.ts';
import { verdict, type GoldenCase, type Verdict } from './golden.ts';
import { citationValidity, claimLabelling, fieldMatch, safety, type Ratio } from './scorers.ts';

// Runs golden cases, scores them and applies the thresholds (AIV-P0-029).

/** Where a case's answer comes from: its recorded output, or the task's runner against a model. */
export type Answer = (task: string, golden: GoldenCase) => Promise<unknown>;
/** Judges an output against a rubric where exact match is not possible. */
export type Judge = (rubric: string, golden: GoldenCase, output: unknown) => Promise<Verdict>;

const metrics = ['citationValidity', 'claimLabelling', 'fieldMatch', 'safety', 'judge'] as const;
type Metric = (typeof metrics)[number];

type CaseResult = { id: string; passed: boolean; error?: string; scores: Partial<Record<Metric, Ratio>> };
export type TaskReport = {
  task: string;
  passed: boolean;
  cases: CaseResult[];
  /** Pooled across the task's cases; null when no case had anything to score. */
  rates: Record<Metric, number | null>;
  thresholds: Record<Metric, number>;
};

export const recordedAnswer: Answer = async (_task, golden) => golden.recorded.output;
export const recordedJudge: Judge = async (_rubric, golden) => {
  if (!golden.recorded.judge) throw new Error('no recorded verdict');
  return golden.recorded.judge;
};

/** The judge's prompt, versioned in code (ADR-006). It sees the rubric, the synthetic sources and the output only. */
export const judgePrompt = {
  id: 'evals.judge@1',
  system:
    'You grade one AI output for Aivera, a hiring tool, against a rubric. Read the rubric, the sources the output ' +
    'was given and the output. Answer with JSON only: {"pass": boolean, "reason": string}. Pass only if the output ' +
    'meets every point of the rubric; the reason names the point it fails or confirms in one sentence.',
};

// A fixed synthetic workspace: the live run's budget is counted apart from any real workspace.
export const evalWorkspaceId = '0190d4a2-0000-7000-8000-0000000e7a1e';

/** The LLM judge on the `evals.judge` task. A verdict that is not the schema is rejected, never patched (AGENTS.md 3.7). */
// shortcut: free-text JSON validated with zod; switch to generateStructured once AIV-P0-028 (#60) lands it.
export function liveJudge(ai: AiClient): Judge {
  return async (rubric, golden, output) => {
    const { text } = await ai.generate({
      task: 'evals.judge',
      workspaceId: evalWorkspaceId,
      system: judgePrompt.system,
      prompt: JSON.stringify({ rubric, sources: golden.sources, output }),
    });
    const parsed = verdict.safeParse(JSON.parse(text));
    if (!parsed.success) throw new Error('judge verdict failed its schema');
    return parsed.data;
  };
}

async function scoreCase(task: string, golden: GoldenCase, answer: Answer, judge: Judge): Promise<CaseResult> {
  const { expected, sources } = golden;
  const { statements: statementPaths } = taskThresholds[task] ?? { statements: [] };
  try {
    const output = await answer(task, golden);
    const scores: CaseResult['scores'] = {
      citationValidity: citationValidity(output, sources, statementPaths),
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
  const passed =
    results.every((result) => !result.error) &&
    metrics.every((metric) => rates[metric] === null || (rates[metric] ?? 0) >= thresholds[metric]);
  return { task, passed, cases: results, rates, thresholds };
}

const labels: Record<Metric, string> = {
  citationValidity: 'Citation validity',
  claimLabelling: 'Claim labelling',
  fieldMatch: 'Field match',
  safety: 'Safety',
  judge: 'Judge',
};

const percent = (rate: number) => `${Math.floor(rate * 1000) / 10}%`;

/** One line per case: result, each score, and what failed. */
export function caseLines(report: TaskReport): string[] {
  return report.cases.flatMap((result) => {
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
  ].join('\n');
}
