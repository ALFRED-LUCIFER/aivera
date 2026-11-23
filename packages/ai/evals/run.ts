import { createHash } from 'node:crypto';
import { MockLanguageModelV4 } from 'ai/test';
import { z } from 'zod';
import { AiUnavailable, createAiClient, memoryTokenBudget, type AiClient } from '../src/client.ts';
import { fakeProvider } from '../src/providers.ts';
import { serviceTasks } from '../src/service.ts';
import { hardGates, runners, taskThresholds, type Runner } from './config.ts';
import { identifiersOf, verdict, type GoldenCase, type JudgeCase, type Verdict } from './golden.ts';
import {
  citationValidity,
  claimLabelling,
  contract,
  fieldMatch,
  missedPoints,
  promptSafety,
  safety,
  valuesAt,
  type Ratio,
} from './scorers.ts';

// Runs golden cases, scores them and applies the thresholds (AIV-P0-029).

/** Where a case's answer comes from: its recorded output, or the task's runner against a model. */
export type Answer = (task: string, golden: GoldenCase) => Promise<unknown>;
/** Judges an output against a rubric where exact match is not possible. */
export type Judge = (rubric: string, golden: GoldenCase, output: unknown) => Promise<Verdict>;
/**
 * For each expected free-text value the output missed word for word, the output value that means the same, or null
 * (AIV-P2-083). Keyed by the expected value.
 */
export type Matcher = (
  golden: GoldenCase,
  misses: { expected: string; candidates: string[] }[],
) => Promise<Record<string, string | null>>;

const metrics = ['citationValidity', 'contract', 'claimLabelling', 'fieldMatch', 'safety', 'judge', 'prompt'] as const;
type Metric = (typeof metrics)[number];

type CaseResult = {
  id: string;
  passed: boolean;
  error?: string;
  scores: Partial<Record<Metric, Ratio>>;
  /** The matcher's verdicts for this case (config.ts `meaning`): what a re-recording stores as `recorded.matches`. */
  matches?: Record<string, string | null>;
};
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
class StaleRecording extends Error {
  override name = 'StaleRecording';
}

/**
 * The prompt a case's answer comes from (AIV-P1-085): the version in code, and a hash of the request the client hands
 * the model for this case (deployment, messages with the shared rules and the sources as the model reads them, output
 * schema, temperature, token limit), so an edit without a version bump shows too; for a task the AI service serves,
 * the request sent to it and the output schema it asks for. Null for a task with no runner yet.
 * No model is called and nothing is spent: the request is captured and the call stopped.
 */
export async function promptOf(
  task: string,
  golden: GoldenCase,
  runner: Runner | undefined = runners[task],
): Promise<{ version: string; hash: string } | null> {
  if (!runner) return null;
  let version: string | undefined;
  let hash: string | undefined;
  const capture = (sent: unknown): never => {
    hash = createHash('sha256').update(JSON.stringify(sent)).digest('hex').slice(0, 12);
    throw new Error('captured');
  };
  const ai = createAiClient({
    budget: memoryTokenBudget(),
    service: async (serviceTask, request) => capture([serviceTask, request, z.toJSONSchema(serviceTasks[serviceTask])]),
    provider: {
      ...fakeProvider(),
      languageModel: (deployment) =>
        new MockLanguageModelV4({
          provider: 'capture',
          modelId: deployment,
          doGenerate: async ({ prompt, responseFormat, temperature, maxOutputTokens }) =>
            capture([deployment, prompt, responseFormat, temperature, maxOutputTokens]),
        }),
    },
  });
  const recording: Pick<AiClient, 'generateStructured'> = {
    generateStructured: (request) => {
      version = request.promptVersion;
      return ai.generateStructured(request);
    },
  };
  // The stopped call surfaces as AiUnavailable; anything else, or anything before a request was captured, is a real
  // error. A runner sends one request per case: a second one would not be reached, so not hashed.
  await runner(recording, golden, evalWorkspaceId).catch((error: unknown) => {
    if (!hash || !(error instanceof AiUnavailable)) throw error;
  });
  if (!version || !hash) throw new Error(`the ${task} runner sent no request`);
  return { version, hash };
}

/**
 * The case's recorded output, refused when the prompt in code is not the one it was recorded with: an edited prompt
 * never passes on answers it did not produce (AGENTS.md 3.12).
 */
export const recordedAnswer: Answer = async (task, golden) => {
  const prompt = await promptOf(task, golden);
  const { promptVersion = 'no prompt version', promptHash = 'none' } = golden.recorded;
  if (prompt && promptVersion !== prompt.version)
    throw new StaleRecording(
      `recorded with ${promptVersion}, code is ${prompt.version}: re-record (prompt hash ${prompt.hash})`,
    );
  if (prompt && promptHash !== prompt.hash)
    throw new StaleRecording(`recorded with prompt hash ${promptHash}, code is ${prompt.hash}: re-record`);
  return golden.recorded.output;
};
/** The recorded verdicts: an expected value with none recorded does not match, so a recorded run stays exact. */
export const recordedMatcher: Matcher = async (golden) => golden.recorded.matches ?? {};
export const recordedJudge: Judge = async (_rubric, golden) => {
  if (!golden.recorded.judge) throw new Error('no recorded verdict');
  return golden.recorded.judge;
};

/**
 * The judge's prompt, versioned in code (ADR-006). It sees the rubric, the synthetic sources and the output only.
 * Every change re-runs the judge golden cases live (evals/judge, AIV-P2-084) and records their verdicts.
 */
export const judgePrompt = {
  id: 'evals.judge@4',
  system:
    'You grade one AI output for Credalent, a hiring tool, against a rubric. Read the rubric, the output and the ' +
    'sources the output was given. Pass only if the output meets every point of the rubric; the reason names the ' +
    'point and item it fails, or confirms the point, in one sentence. Check the rubric item by item: when it speaks ' +
    'of every item (every link, every statement), check each one and fail if any one does not meet it. Judge what ' +
    'the output says, not how strong the candidate or the evidence is: a limit that names what its evidence does ' +
    'not show meets a rubric asking for that, however thin the evidence. Text that names nothing specific (praise, ' +
    '"see the source") does not meet a point asking the output to name something. Every source is about the ' +
    "candidate: a repository source's authored commit count is the candidate's own authorship. Before you pass a " +
    'limit, compare it with the sources: a limit saying the evidence does not show something a source states (who ' +
    'wrote the work, a count, a date) is false, and a false limit does not meet the rubric. A limit about what the ' +
    'sources leave out is not false.',
};

export const matchPrompt = {
  id: 'evals.match@1',
  system:
    'You compare short texts: competency names, or statements from a CV. For each expected text, give the one of ' +
    'its options that means the same, worded differently, or null when none does. Same meaning: the same skill, area of ' +
    'work or fact, not merely a related one ("Incident response" and "On-call incident handling" match; "Incident ' +
    'response" and "Monitoring" do not; "cut cost per request by 40%" matches a longer line stating that cut). Copy ' +
    'the option exactly. Answer for every expected text, in order.',
};
const matchVerdicts = z.object({
  matches: z.array(z.object({ expected: z.string(), match: z.string().nullable() }).strict()),
});

/** The LLM matcher on the `evals.judge` task (AIV-P2-083): one call per case, for its missed free-text names only. */
export function liveMatcher(ai: Pick<AiClient, 'generateStructured'>): Matcher {
  return async (_golden, misses) => {
    const { matches } = await ai.generateStructured({
      task: 'evals.judge',
      workspaceId: evalWorkspaceId,
      promptVersion: matchPrompt.id,
      system: matchPrompt.system,
      prompt: JSON.stringify(misses),
      schema: matchVerdicts,
      sources: [],
    });
    return Object.fromEntries(matches.map((m) => [m.expected, m.match]));
  };
}

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

async function scoreCase(
  task: string,
  golden: GoldenCase,
  answer: Answer,
  judge: Judge,
  matcher: Matcher,
): Promise<CaseResult> {
  const { expected, sources } = golden;
  const { statements: statementPaths } = taskThresholds[task] ?? { statements: [] };
  try {
    const output = await answer(task, golden);
    let matches: Record<string, string | null> | undefined;
    const scores: CaseResult['scores'] = {
      citationValidity: citationValidity(output, sources, statementPaths),
      contract: contract(task, output, sources),
      claimLabelling: claimLabelling(output, sources, statementPaths),
    };
    if (expected.match) {
      // Free-text paths the task declares (config.ts `meaning`) may match by meaning; everything else stays exact.
      const meaning = new Set(taskThresholds[task]?.meaning ?? []);
      const misses = missedPoints(output, expected.match).filter(
        (p): p is { path: string; value: string } => meaning.has(p.path) && typeof p.value === 'string',
      );
      // An output value that already matches an expected one exactly is taken: only the rest may answer a miss.
      const taken = (path: string) => [expected.match?.[path]].flat();
      const free = (path: string) =>
        valuesAt(output, path).filter((v): v is string => typeof v === 'string' && !taken(path).includes(v));
      if (misses.length)
        matches = await matcher(
          golden,
          misses.map((p) => ({ expected: p.value, candidates: free(p.path) })),
        );
      const used = new Set<string>();
      scores.fieldMatch = fieldMatch(output, expected.match, ({ path, value }) => {
        const found = typeof value === 'string' ? matches?.[value] : null;
        // A verdict counts only when the value it names is free in the output at that path, and once.
        if (!meaning.has(path) || typeof found !== 'string' || !free(path).includes(found)) return false;
        if (used.has(`${path}\u0000${found}`)) return false;
        used.add(`${path}\u0000${found}`);
        return true;
      });
    }
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
    return { id: golden.id, passed, scores, ...(matches ? { matches } : {}) };
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
  matcher: Matcher,
): Promise<TaskReport> {
  const thresholds = thresholdsOf(task);
  const results: CaseResult[] = [];
  for (const golden of cases) results.push(await scoreCase(task, golden, answer, judge, matcher)); // one call at a time
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

/** A judge golden case's verdict: from the live judge, or as recorded (AIV-P2-084). */
export type JudgeVerdict = (c: JudgeCase) => Promise<Verdict>;
/** The recorded verdict, refused when the judge prompt in code is not the one it was recorded with. */
export const recordedJudgeVerdict: JudgeVerdict = async (c) => {
  if (c.recorded.judgePrompt !== judgePrompt.id)
    throw new StaleRecording(
      `judge verdict recorded with ${c.recorded.judgePrompt}, code is ${judgePrompt.id}: re-run the judge golden cases live`,
    );
  return c.recorded.verdict;
};
export const liveJudgeVerdict =
  (judge: Judge): JudgeVerdict =>
  (c) =>
    judge(c.rubric, c.golden, c.output);

/**
 * The judge's own golden cases (AIV-P2-084): each passes when the verdict is the expected one. The report names the
 * expected and given verdicts only, never the judge's reason (it can quote the sources, AGENTS.md 1.2).
 */
export async function evaluateJudge(cases: JudgeCase[], verdictOf: JudgeVerdict): Promise<TaskReport> {
  const results: CaseResult[] = [];
  for (const c of cases) {
    try {
      const given = (await verdictOf(c)).pass ? 'pass' : 'fail';
      const passed = given === c.expected;
      const failures = passed ? [] : [`judge: expected ${c.expected}, the judge said ${given}`];
      results.push({ id: c.id, passed, scores: { judge: { n: passed ? 1 : 0, total: 1, failures } } });
    } catch (error) {
      const name = error instanceof Error ? error.name : 'error';
      results.push({
        id: c.id,
        passed: false,
        error: error instanceof StaleRecording ? error.message : name,
        scores: {},
      });
    }
  }
  const scored = results.filter((r) => r.scores.judge);
  const rates = Object.fromEntries(metrics.map((metric) => [metric, null])) as Record<Metric, number | null>;
  if (scored.length) rates.judge = scored.filter((r) => r.passed).length / scored.length;
  // Every case must get its expected verdict: one judge miss can pass a mapping that misstates its evidence.
  const thresholds = { ...hardGates, fieldMatch: 1, judge: 1 };
  return { task: 'evals.judge', passed: results.every((r) => r.passed), cases: results, rates, thresholds, groups: [] };
}
