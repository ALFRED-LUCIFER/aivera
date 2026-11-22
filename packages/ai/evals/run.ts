import { createHash } from 'node:crypto';
import { z } from 'zod';
import { CITATION_RULES, UNTRUSTED_CONTENT_RULES, type AiClient } from '../src/client.ts';
import { hardGates, runners, taskThresholds, type Runner } from './config.ts';
import { identifiersOf, verdict, type GoldenCase, type Verdict } from './golden.ts';
import { citationValidity, claimLabelling, contract, fieldMatch, promptSafety, safety, type Ratio } from './scorers.ts';

// Runs golden cases, scores them and applies the thresholds (AIV-P0-029).

/** Where a case's answer comes from: its recorded output, or the task's runner against a model. */
export type Answer = (task: string, golden: GoldenCase) => Promise<unknown>;
/** Judges an output against a rubric where exact match is not possible. */
export type Judge = (rubric: string, golden: GoldenCase, output: unknown) => Promise<Verdict>;

const metrics = ['citationValidity', 'contract', 'claimLabelling', 'fieldMatch', 'safety', 'judge', 'prompt'] as const;
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
  groups: (Ratio & { group: string; label: string; min: number })[];
};

// A fixed synthetic workspace: the live run's budget is counted apart from any real workspace.
export const evalWorkspaceId = '0190d4a2-0000-7000-8000-0000000e7a1e';

/** A recorded answer whose prompt has changed since: the message holds prompt ids and hashes only. */
export class StaleRecording extends Error {
  override name = 'StaleRecording';
}

/**
 * The prompt a case's answer comes from (AIV-P1-085): the version in code, and a hash of what the task's runner sends
 * for this case (system text with the shared rules, the prompt and the schema), so an edit without a version bump
 * shows too. Null for a task with no runner yet. No model is called: the request is captured and the call stopped.
 * shortcut: a rule JSON Schema cannot hold (a .refine) is not in the hash, upgrade if a prompt schema gains one;
 * bump the version with it (the prompt files say so).
 */
export async function promptOf(
  task: string,
  golden: GoldenCase,
  runner: Runner | undefined = runners[task],
): Promise<{ version: string; hash: string } | null> {
  if (!runner) return null;
  const captured = new Error('captured');
  let found: { version: string; hash: string } | undefined;
  const capture = async (request: { promptVersion: string; system: string; prompt: string; schema: z.ZodType }) => {
    const sent = [
      request.system,
      CITATION_RULES,
      UNTRUSTED_CONTENT_RULES,
      request.prompt,
      z.toJSONSchema(request.schema),
    ];
    const hash = createHash('sha256').update(JSON.stringify(sent)).digest('hex').slice(0, 12);
    found = { version: request.promptVersion, hash };
    throw captured;
  };
  try {
    await runner({ generateStructured: capture as AiClient['generateStructured'] }, golden, evalWorkspaceId);
  } catch (error) {
    if (error !== captured) throw error;
  }
  if (!found) throw new Error(`the ${task} runner sent no request`);
  return found;
}

/**
 * The case's recorded output, refused when the prompt in code is not the one it was recorded with: an edited prompt
 * never passes on answers it did not produce (AGENTS.md 3.12).
 */
export const recordedAnswer: Answer = async (task, golden) => {
  const prompt = await promptOf(task, golden);
  const { promptVersion = 'no prompt version', promptHash = 'none' } = golden.recorded;
  if (prompt && promptVersion !== prompt.version)
    throw new StaleRecording(`recorded with ${promptVersion}, code is ${prompt.version}: re-record`);
  if (prompt && promptHash !== prompt.hash)
    throw new StaleRecording(`recorded with prompt hash ${promptHash}, code is ${prompt.hash}: re-record`);
  return golden.recorded.output;
};
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

/**
 * The LLM judge on the `evals.judge` task, through the structured-output contract: a verdict that is not the schema
 * fails with SchemaMismatch, never patched (AGENTS.md 3.7).
 */
export function liveJudge(ai: Pick<AiClient, 'generateStructured'>): Judge {
  return async (rubric, golden, output) =>
    ai.generateStructured({
      task: 'evals.judge',
      workspaceId: evalWorkspaceId,
      promptVersion: judgePrompt.id,
      system: judgePrompt.system,
      prompt: JSON.stringify({ rubric, output }),
      schema: verdict,
      sources: golden.sources,
      // The judge reads the sources redacted, as the task's model did; the output in its prompt carries the stored
      // text of each quote (synthetic cases only).
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
    if (expected.prompt) scores.prompt = promptSafety(task, golden, expected.prompt.forbidden);
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
    // The error's name only: a provider's error can repeat the prompt (AGENTS.md 1.2). A stale recording's message is
    // prompt ids and hashes, and tells the developer what to do.
    const name = error instanceof Error ? error.name : 'error';
    return { id: golden.id, passed: false, error: error instanceof StaleRecording ? error.message : name, scores: {} };
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
    return { group, label, min, n: inGroup.length - failures.length, total: inGroup.length, failures };
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
  prompt: 'Prompt safety',
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
