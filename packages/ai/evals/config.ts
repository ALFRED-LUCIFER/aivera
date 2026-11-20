import { readFileSync } from 'node:fs';
import type { AiClient } from '../src/client.ts';
import { z } from 'zod';
import { detectDomainRequest } from '../src/prompts/jobs.detectDomain.ts';
import { draftCompetenciesRequest } from '../src/prompts/jobs.draftCompetencies.ts';
import { mapToCompetencyRequest } from '../src/prompts/evidence.mapToCompetency.ts';
import type { GoldenCase } from './golden.ts';

const jobInput = z.object({ jobType: z.string().min(1), title: z.string().min(1) });
const rubricInput = z.object({
  competencies: z.array(z.object({ id: z.string().min(1), name: z.string().min(1), evidenceExpected: z.string() })),
});

/** The catalogue version 1 snapshot committed with AIV-P2-043, which the jobs migration 0012 seeds (ADR-013 point 9). */
export const CATALOGUE_SNAPSHOT = new URL(
  '../../../modules/jobs/src/infrastructure/catalogue-v1.json',
  import.meta.url,
);
const keys = z.array(z.object({ key: z.string() })).nonempty();
const snapshot = z.object({ packs: keys, regions: keys }).parse(JSON.parse(readFileSync(CATALOGUE_SNAPSHOT, 'utf8')));

/**
 * The pack and region keys of catalogue version 1, read from its snapshot: this package cannot import the jobs module
 * (jobs depends on it). eval.test.ts fails when the snapshot drifts from the seed migration. A later version is
 * evaluated live with its draft as data before it can publish (ADR-013 point 12, AIV-P2-048).
 */
export const domainCatalogue = {
  domains: snapshot.packs.map((p) => p.key) as [string, ...string[]],
  regions: snapshot.regions.map((r) => r.key) as [string, ...string[]],
};

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
 * task's cases, so one case may fail while the task passes a pooled threshold below 100%. `groups` adds, per case group
 * (a case's `group`), the share of its cases that must pass every metric; it never relaxes a hard gate.
 */
export const taskThresholds: Record<
  string,
  { statements: string[]; fieldMatch: number; judge: number; groups?: Record<string, { label: string; min: number }> }
> = {
  'jobs.draftCompetencies': { statements: ['competencies[*]', 'suggestions[*]'], fieldMatch: 0.9, judge: 1 },
  // `industry` is a statement only when it names a domain (it then carries citations); `none` cites nothing.
  // AIV-P1-066: pack and near-miss cases (domain), descriptions with no industry (none) and fairness cases. A group
  // counts a case only when it passes every metric, so "domain accuracy" also needs the right regions.
  'jobs.detectDomain': {
    statements: ['regions[*]'],
    fieldMatch: 0.9,
    judge: 1,
    groups: {
      domain: { label: 'Domain accuracy', min: 0.9 },
      none: { label: 'No clear domain', min: 5 / 6 },
      fairness: { label: 'Fairness', min: 1 },
    },
  },
  'evidence.mapToCompetency': { statements: ['links[*]'], fieldMatch: 0.9, judge: 1 },
  'evidence.firstPass': { statements: ['mustHaves[*]'], fieldMatch: 0.9, judge: 1 },
};

/**
 * Asks the model for one case's answer; the live run's only way in. Its feature ticket registers it with its prompt and
 * schema, calling `ai.generateStructured` with the case's sources and `workspaceId` (so every call counts against
 * liveTokenCap). A contract error (UncitedOutput, InvalidCitation, SchemaMismatch) fails the case under its name.
 */
export type Runner = (ai: AiClient, golden: GoldenCase, workspaceId: string) => Promise<unknown>;

// shortcut: evidence.firstPass has no prompt yet; AIV-P1-020 adds its runner.
export const runners: Record<string, Runner> = {
  // The product's own prompt and schema (AIV-P1-008), as the jobs module calls them.
  'jobs.draftCompetencies': (ai, golden, workspaceId) =>
    ai.generateStructured({ ...draftCompetenciesRequest(jobInput.parse(golden.input), golden.sources), workspaceId }),
  // AIV-P1-063: sources are the description (S1) and, when the job has one, the location (S2), as the jobs module sends.
  'jobs.detectDomain': (ai, golden, workspaceId) =>
    ai.generateStructured({
      ...detectDomainRequest(jobInput.parse(golden.input), domainCatalogue, golden.sources),
      workspaceId,
    }),
  // AIV-P1-027: the approved rubric's competencies in the prompt, one source per evidence source, as the evidence module sends.
  'evidence.mapToCompetency': (ai, golden, workspaceId) =>
    ai.generateStructured({
      ...mapToCompetencyRequest(rubricInput.parse(golden.input).competencies, golden.sources),
      workspaceId,
    }),
};

/** Tokens one live run may spend across all its calls; past it the remaining cases error and the run fails. */
export const liveTokenCap = 300_000;
