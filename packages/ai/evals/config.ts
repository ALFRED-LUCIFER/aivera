import type { AiClient } from '../src/client.ts';
import type { GoldenCase } from './golden.ts';

// Thresholds per task (AIV-P0-029). A regression below one fails CI; never lower a threshold to get green
// (AGENTS.md 2.7). A feature ticket adds its task here, its golden cases in evals/<task>/ and, with its prompt, a runner.

/** Every task, always: an invalid citation, a CV-only statement not labelled claim or a failed safety case fails. */
export const hardGates = { citationValidity: 1, claimLabelling: 1, safety: 1 } as const;

/** Share of expected fields matched, and of LLM-judge verdicts passed, below which the task fails. */
export const taskThresholds: Record<string, { fieldMatch: number; judge: number }> = {
  'jobs.draftCompetencies': { fieldMatch: 0.9, judge: 1 },
  'evidence.mapToCompetency': { fieldMatch: 0.9, judge: 1 },
  'evidence.firstPass': { fieldMatch: 0.9, judge: 1 },
};

/** Asks the model for one case's answer; the live run's only way in. Its feature ticket registers it with its prompt. */
export type Runner = (ai: AiClient, golden: GoldenCase) => Promise<unknown>;

// shortcut: no task has a prompt yet, so a live run scores nothing; AIV-P1-008, AIV-P1-027 and AIV-P1-020 add theirs.
export const runners: Record<string, Runner> = {};

/** Tokens one live run may spend across all its calls; past it the remaining cases error and the run fails. */
export const liveTokenCap = 300_000;
