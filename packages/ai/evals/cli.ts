// pnpm ai:eval [--task <name>] [--live] [--dir <golden dir>] [--out <results.json>] (AIV-P0-029).
// Scores the recorded answers by default: deterministic, free and offline. --live asks the dev AI deployment instead
// (ADR-011: synthetic data only), within liveTokenCap. Exits 1 when a threshold fails, 2 on a usage error.
import { appendFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { createAiClient, memoryTokenBudget } from '../src/client.ts';
import { deployments } from '../src/config.ts';
import { providerFromEnv } from '../src/providers.ts';
import { liveTokenCap, runners, taskThresholds } from './config.ts';
import { loadGolden } from './golden.ts';
import {
  caseLines,
  evalWorkspaceId,
  evaluateTask,
  judgePrompt,
  liveJudge,
  recordedAnswer,
  recordedJudge,
  summaryTable,
  type TaskReport,
} from './run.ts';

const usage = (message: string): never => {
  console.error(`${message}\nUsage: pnpm ai:eval [--task <name>] [--live] [--dir <golden dir>] [--out <file.json>]`);
  process.exit(2);
};

const { values } = parseArgs({
  options: {
    task: { type: 'string' },
    live: { type: 'boolean', default: false },
    dir: { type: 'string', default: import.meta.dirname },
    out: { type: 'string' },
  },
});

const golden = (() => {
  try {
    return loadGolden(values.dir);
  } catch (error) {
    return usage(error instanceof Error ? error.message : 'invalid golden set');
  }
})();
for (const task of golden.keys()) if (!taskThresholds[task]) usage(`No thresholds for task ${task} in evals/config.ts`);
// Before any scoring, so a typo is a usage error (exit 2), never a failed threshold, and a live run spends nothing.
for (const [task, cases] of golden)
  for (const c of cases)
    if (c.group !== undefined && !taskThresholds[task]?.groups?.[c.group])
      usage(`${task}/${c.id}: no group ${c.group} in evals/config.ts`);
if (values.task && !golden.has(values.task)) usage(`No golden cases for task ${values.task}`);
const tasks = [...golden].filter(([task]) => !values.task || task === values.task);

let answer = recordedAnswer;
let judge = recordedJudge;
if (values.live) {
  // Dev and local only: the golden set is synthetic, but a run must never spend a pilot workspace's model.
  if (process.env['APP_ENV'] !== 'dev' && process.env['APP_ENV'] !== 'local')
    usage('--live needs APP_ENV=dev or local');
  const ai = createAiClient({ provider: providerFromEnv(process.env), budget: memoryTokenBudget(liveTokenCap) });
  answer = async (task, goldenCase) => {
    const runner = runners[task];
    if (!runner) throw new Error(`no runner for ${task}`);
    return runner(ai, goldenCase, evalWorkspaceId);
  };
  judge = liveJudge(ai);
}

const reports: TaskReport[] = [];
for (const [task, cases] of tasks) {
  if (values.live && !runners[task]) {
    console.log(`SKIP ${task}: no prompt registered yet, so nothing to run live (the recorded answers still gate CI)`);
    continue;
  }
  const report = await evaluateTask(task, cases, answer, judge);
  for (const line of caseLines(report)) console.log(line);
  reports.push(report);
}

const summary = reports.length ? summaryTable(reports) : 'No task ran.';
console.log(`\n${summary}`);
const passed = reports.every((report) => report.passed);
const stepSummary = process.env['GITHUB_STEP_SUMMARY'];
if (stepSummary) appendFileSync(stepSummary, `### AI eval (${values.live ? 'live' : 'recorded'})\n\n${summary}\n`);
if (values.out) {
  const at = new Date().toISOString();
  const mode = values.live ? 'live' : 'recorded';
  // The judge's prompt id and the deployments' models, so a trend can tell a prompt change from a model change.
  const versions = { judge: judgePrompt.id, deployments };
  const results = { at, mode, commit: process.env['GITHUB_SHA'], versions, passed, reports };
  writeFileSync(values.out, `${JSON.stringify(results, null, 2)}\n`);
}
process.exit(passed ? 0 : 1);
