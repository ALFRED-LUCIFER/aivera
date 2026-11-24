import { readFileSync } from 'node:fs';
import type { AiClient } from '../src/client.ts';
import { z } from 'zod';
import { parseCvRequest } from '../src/prompts/evidence.parseCv.ts';
import { detectDomainRequest } from '../src/prompts/jobs.detectDomain.ts';
import { draftCompetenciesRequest } from '../src/prompts/jobs.draftCompetencies.ts';
import { mapToCompetencyRequest } from '../src/prompts/evidence.mapToCompetency.ts';
import { compareExcerptsRequest, flaggedPairs } from '../src/prompts/evidence.compareExcerpts.ts';
import { assistantAnswerRequest } from '../src/prompts/assistant.answer.ts';
import { identifiersOf, type GoldenCase } from './golden.ts';

const jobInput = z.object({ jobType: z.string().min(1), title: z.string().min(1) });
const questionInput = z.object({ question: z.string().min(1) });
const pairsInput = z.object({ pairs: z.array(z.tuple([z.string(), z.string()])).min(1) });
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
 * claim, a failed safety case or a protected trait left in the prompt (AIV-P2-065) fails.
 */
export const hardGates = { citationValidity: 1, contract: 1, claimLabelling: 1, safety: 1, prompt: 1 } as const;

/**
 * Per task: where its statements are (each must cite and is scored even when the model drops its `citations`), and the
 * share of expected fields matched and of LLM-judge verdicts passed below which it fails. Rates are pooled across the
 * task's cases, so one case may fail while the task passes a pooled threshold below 100%. `groups` adds, per case group
 * (a case's `group`), the share of its cases that must pass every metric; it never relaxes a hard gate.
 */
export const taskThresholds: Record<
  string,
  {
    statements: string[];
    fieldMatch: number;
    judge: number;
    groups?: Record<string, { label: string; min: number }>;
    /** Free-text paths a missed value may match by meaning (run.ts Matcher); every other path is matched exactly. */
    meaning?: string[];
  }
> = {
  // AIV-P2-083: a competency name is free text a live model never words like the golden case, so its names match by
  // meaning (the LLM matcher, its verdicts recorded per case); enums, ids, emails and phones stay exact everywhere.
  'jobs.draftCompetencies': {
    statements: ['competencies[*]', 'suggestions[*]'],
    fieldMatch: 0.9,
    judge: 1,
    meaning: ['competencies[*].name', 'suggestions[*].name'],
  },
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
  // AIV-P1-078: one case per pair the numeric pre-check leaves `not_settled` (modules/evidence/src/application/mapping.test.ts
  // proves each is). A case passes only with every metric, so a group's pass rate is the recall over contradictions and
  // one minus the false-positive rate over consistent pairs. Those two groups are the gate; the pooled field match sits
  // below them so a failing run is named by the group it fails.
  'evidence.compareExcerpts': {
    statements: ['contradictions[*]'],
    fieldMatch: 0.8,
    judge: 1,
    groups: {
      contradiction: { label: 'Recall', min: 0.9 },
      consistent: { label: 'Consistent pairs not flagged (1 - false-positive rate)', min: 5 / 6 },
    },
  },
  // AIV-P1-025: every role, skill and statement must cite the CV and is a claim. Recorded answers are checked ones
  // (`claim: true` from code), as the runner returns them. Recall after the repair passes is the evidence module's
  // test over the same cases (modules/evidence/src/domain/cv.golden.test.ts).
  // AIV-P2-081: a statement is the CV's words, but the model trims or extends a sentence ("cut cost per request by 40%"
  // inside a longer line), so statement text matches by meaning too; skills and contact stay exact.
  'evidence.parseCv': {
    statements: ['workHistory[*]', 'skills[*]', 'statements[*]'],
    fieldMatch: 1,
    judge: 1,
    meaning: ['statements[*].text'],
  },
  // AIV-P2-068: the assistant's answers through the Python AI service; every statement cites, a CV-only one is a claim,
  // and it never recommends rejecting anyone. Recorded answers are checked ones, as the client returns them.
  'assistant.answer': { statements: ['statements[*]'], fieldMatch: 1, judge: 1 },
};

/**
 * Asks the model for one case's answer; the live run's only way in. Its feature ticket registers it with its prompt and
 * schema, calling `ai.generateStructured` with the case's sources and `workspaceId` (so every call counts against
 * liveTokenCap). A contract error (UncitedOutput, InvalidCitation, SchemaMismatch) fails the case under its name.
 */
export type Runner = (
  ai: Pick<AiClient, 'generateStructured'>,
  golden: GoldenCase,
  workspaceId: string,
) => Promise<unknown>;

/**
 * `jobs.detectDomain` against `catalogue`'s pack and region keys: version 1's snapshot in CI, a draft's in its live eval
 * (AIV-P2-048). AIV-P1-063: sources are the description (S1) and, when the job has one, the location (S2), as the jobs
 * module sends.
 */
export const detectDomainRunner =
  (catalogue: { domains: [string, ...string[]]; regions: [string, ...string[]] }): Runner =>
  (ai, golden, workspaceId) =>
    ai.generateStructured({
      ...detectDomainRequest(jobInput.parse(golden.input), catalogue, golden.sources),
      workspaceId,
    });

// shortcut: evidence.firstPass has no prompt yet; AIV-P1-020 adds its runner.
export const runners: Record<string, Runner> = {
  // The product's own prompt and schema (AIV-P1-008), as the jobs module calls them.
  'jobs.draftCompetencies': (ai, golden, workspaceId) =>
    ai.generateStructured({ ...draftCompetenciesRequest(jobInput.parse(golden.input), golden.sources), workspaceId }),
  'jobs.detectDomain': detectDomainRunner(domainCatalogue),
  // AIV-P1-027: the approved rubric's competencies in the prompt, one source per evidence source, as the evidence module sends.
  'evidence.mapToCompetency': (ai, golden, workspaceId) =>
    ai.generateStructured({
      ...mapToCompetencyRequest(rubricInput.parse(golden.input).competencies, golden.sources),
      workspaceId,
      identifiers: identifiersOf(golden),
    }),
  // AIV-P1-078: the pair's two excerpts as sources; a flag citing anything but a requested pair fails the case.
  'evidence.compareExcerpts': async (ai, golden, workspaceId) => {
    const { pairs } = pairsInput.parse(golden.input);
    const answer = await ai.generateStructured({
      ...compareExcerptsRequest(golden.sources, pairs),
      workspaceId,
      identifiers: identifiersOf(golden),
    });
    flaggedPairs(answer, pairs);
    return answer;
  },
  // AIV-P1-025: the CV text Document Intelligence extracted is the one source, as the evidence module sends it.
  'evidence.parseCv': (ai, golden, workspaceId) =>
    ai.generateStructured({ ...parseCvRequest(golden.sources), workspaceId, identifiers: identifiersOf(golden) }),
  // AIV-P2-068: the recruiter's question in the prompt, the page's sources as sources, through the AI service.
  'assistant.answer': (ai, golden, workspaceId) =>
    ai.generateStructured({
      ...assistantAnswerRequest(questionInput.parse(golden.input).question, golden.sources),
      workspaceId,
      identifiers: identifiersOf(golden),
    }),
};

/** Tokens one live run may spend across all its calls; past it the remaining cases error and the run fails. */
export const liveTokenCap = 300_000;
