import type { AiClient } from '../src/client.ts';
import { z } from 'zod';
import { detectDomainRequest } from '../src/prompts/jobs.detectDomain.ts';
import { draftCompetenciesRequest } from '../src/prompts/jobs.draftCompetencies.ts';
import type { GoldenCase } from './golden.ts';

const draftInput = z.object({ jobType: z.string().min(1), title: z.string().min(1) });

/**
 * The jobs module's domain catalogue (AIV-P1-061), which this package cannot import (jobs depends on it). eval.test.ts
 * fails when it drifts from DOMAIN_KEYS and REGIONS in modules/jobs/src/domain/domain-packs.ts.
 */
export const domainCatalogue = {
  domains: [
    'payments_fintech',
    'banking_islamic_finance',
    'healthcare',
    'ecommerce_marketplaces',
    'logistics_mobility',
    'government_public_sector',
    'telecom',
    'energy_utilities',
  ],
  regions: ['uae', 'ksa', 'india'],
} as const;

// Thresholds per task (AIV-P0-029). A regression below one fails CI; never lower a threshold to get green
// (AGENTS.md 2.7). A feature ticket adds its task here, its golden cases in evals/<task>/ and, with its prompt, a runner.

/**
 * Every task, always: an invalid citation, an answer the citation contract rejects, a CV-only statement not labelled
 * claim or a failed safety case fails.
 */
export const hardGates = { citationValidity: 1, contract: 1, claimLabelling: 1, safety: 1 } as const;

/**
 * Per task: where its statements are (each must cite and is scored even when the model drops its `citations`), and the
 * share of expected fields matched and of LLM-judge verdicts passed below which it fails. Rates are pooled across the
 * task's cases, so one case may fail while the task passes a pooled threshold below 100%.
 */
export const taskThresholds: Record<string, { statements: string[]; fieldMatch: number; judge: number }> = {
  'jobs.draftCompetencies': { statements: ['competencies[*]'], fieldMatch: 0.9, judge: 1 },
  // `industry` is a statement only when it names a domain (it then carries citations); `none` cites nothing.
  'jobs.detectDomain': { statements: ['regions[*]'], fieldMatch: 0.9, judge: 1 },
  'evidence.mapToCompetency': { statements: ['statements[*]'], fieldMatch: 0.9, judge: 1 },
  'evidence.firstPass': { statements: ['mustHaves[*]'], fieldMatch: 0.9, judge: 1 },
};

/**
 * Asks the model for one case's answer; the live run's only way in. Its feature ticket registers it with its prompt and
 * schema, calling `ai.generateStructured` with the case's sources and `workspaceId` (so every call counts against
 * liveTokenCap). A contract error (UncitedOutput, InvalidCitation, SchemaMismatch) fails the case under its name.
 */
export type Runner = (ai: AiClient, golden: GoldenCase, workspaceId: string) => Promise<unknown>;

// shortcut: only the jobs tasks have a prompt; AIV-P1-027 and AIV-P1-020 add the evidence tasks' runners.
export const runners: Record<string, Runner> = {
  // The product's own prompt and schema (AIV-P1-008), as the jobs module calls them.
  'jobs.draftCompetencies': (ai, golden, workspaceId) =>
    ai.generateStructured({ ...draftCompetenciesRequest(draftInput.parse(golden.input), golden.sources), workspaceId }),
  // AIV-P1-063: sources are the description (S1) and, when the job has one, the location (S2), as the jobs module sends.
  'jobs.detectDomain': (ai, golden, workspaceId) =>
    ai.generateStructured({
      ...detectDomainRequest(draftInput.parse(golden.input), domainCatalogue, golden.sources),
      workspaceId,
    }),
};

/** Tokens one live run may spend across all its calls; past it the remaining cases error and the run fails. */
export const liveTokenCap = 300_000;
