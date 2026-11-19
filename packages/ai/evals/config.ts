import type { AiClient } from '../src/client.ts';
import type { GoldenCase } from './golden.ts';

// Thresholds per task (AIV-P0-029). A regression below one fails CI; never lower a threshold to get green
// (AGENTS.md 2.7). A feature ticket adds its task here, its golden cases in evals/<task>/ and, with its prompt, a runner.

/** Every task, always: an invalid citation, a CV-only statement not labelled claim or a failed safety case fails. */
export const hardGates = { citationValidity: 1, claimLabelling: 1, safety: 1 } as const;

/**
 * Per task: where its statements are (each must cite and is scored even when the model drops its `citations`), and the
 * share of expected fields matched and of LLM-judge verdicts passed below which it fails. Rates are pooled across the
 * task's cases, so one case may fail while the task passes a pooled threshold below 100%.
 */
export const taskThresholds: Record<string, { statements: string[]; fieldMatch: number; judge: number }> = {
  'jobs.draftCompetencies': { statements: ['competencies[*]'], fieldMatch: 0.9, judge: 1 },
  'evidence.mapToCompetency': { statements: ['statements[*]'], fieldMatch: 0.9, judge: 1 },
  'evidence.firstPass': { statements: ['mustHaves[*]'], fieldMatch: 0.9, judge: 1 },
};

/**
 * Asks the model for one case's answer; the live run's only way in. Its feature ticket registers it with its prompt. It
 * must call with `workspaceId`, so every call counts against liveTokenCap.
 */
export type Runner = (ai: AiClient, golden: GoldenCase, workspaceId: string) => Promise<unknown>;

// shortcut: no task has a prompt yet, so a live run scores nothing; AIV-P1-008, AIV-P1-027 and AIV-P1-020 add theirs.
export const runners: Record<string, Runner> = {};

/** Tokens one live run may spend across all its calls; past it the remaining cases error and the run fails. */
export const liveTokenCap = 300_000;
