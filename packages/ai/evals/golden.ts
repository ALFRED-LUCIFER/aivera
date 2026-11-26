import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import type { SourceKind } from '../src/citations.ts';

// One golden case per YAML file in evals/<task>/ (AIV-P0-029). Synthetic data only (docs/00-product/personas.md).

const sourceKinds = [
  'cv',
  'repo',
  'document',
  'reference',
  'interview',
  'job_description',
] as const satisfies readonly SourceKind[];

export const verdict = z.object({ pass: z.boolean(), reason: z.string().min(1) }).strict();
export type Verdict = z.infer<typeof verdict>;

/**
 * The rubric point a drafted suggestion fails (AIV-P2-085, run.ts suggestionPrompt): not needed by the job as
 * described, a listed competency reworded, a proxy, a generic soft skill, or a cited line that does not imply it.
 */
export const suggestionFaults = ['unrelated', 'listed', 'proxy', 'generic', 'citation'] as const;
export type SuggestionFault = (typeof suggestionFaults)[number];

// Matched after `\b` (scorers.ts `has`), which only knows ASCII word characters: a phrase starting with "%", a space or
// a non-ASCII letter would never match where its author means it to.
const phrases = z.array(z.string().regex(/^\w/, 'a phrase starts with an ASCII letter, digit or _')).min(1);

// The competency ids a case's input lists (interviews.mapSummary's `competencies`); none for any other input.
const listedIds = (input: Record<string, unknown>) =>
  z
    .object({ competencies: z.array(z.object({ id: z.string() }).loose()) })
    .loose()
    .safeParse(input)
    .data?.competencies.map((c) => c.id) ?? [];

export const goldenCase = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    /** The task's case group this case is scored in (config.ts taskThresholds groups), if any. */
    group: z.string().min(1).optional(),
    /** Every person the case names; each must be in the synthetic cast. An evidence case names its candidate first. */
    people: z.array(z.string().min(1)).default([]),
    /** The task's input besides its sources (job type, a recruiter's instruction). */
    input: z.record(z.string(), z.unknown()).default({}),
    sources: z
      .array(z.object({ id: z.string().min(1), kind: z.enum(sourceKinds), text: z.string().min(1) }).strict())
      .min(1)
      // The labels the model is shown (citations.ts sourceLabel), so a recorded raw answer and a live checked one cite
      // the same ids.
      .refine((sources) => sources.every((s, i) => s.id === `S${i + 1}`), 'source ids must be S1, S2, ... in order'),
    expected: z
      .object({
        /** Path to expected value; `a[*].b` collects across an array and expects every listed value to be present. */
        match: z.record(z.string(), z.unknown()).optional(),
        safety: z
          .object({
            /** Omitted: refusing and answering are both acceptable, as long as nothing forbidden appears. */
            refused: z.boolean().optional(),
            /** Phrases the refusal's reason must contain (case-insensitive). */
            mentions: z.array(z.string().min(1)).default([]),
            /** Phrases that must appear nowhere in the output except the reason (case-insensitive). */
            forbidden: z.array(z.string().min(1)).default([]),
          })
          .strict()
          .optional(),
        /** Phrases that must appear nowhere in the sources as the model reads them, after redaction (AIV-P2-065). */
        prompt: z
          .object({ forbidden: z.array(z.string().min(1)).min(1) })
          .strict()
          .optional(),
        /**
         * AIV-P1-137: text the output's values at a path must hold (`some`: each phrase in at least one; `every`: each
         * value at least one of the phrases) or never hold (`none`), checked in code (scorers.ts textChecks) and
         * counted in field match: the rubric points about an item's own words, which the LLM judge does not grade
         * reliably.
         */
        text: z
          .array(
            z.union([
              z.object({ path: z.string().min(1), some: phrases }).strict(),
              z.object({ path: z.string().min(1), every: phrases }).strict(),
              z.object({ path: z.string().min(1), none: phrases }).strict(),
            ]),
          )
          .min(1)
          .optional(),
        /**
         * AIV-P1-138: the competencies the answer must propose no change for, by id: any statement for one, whatever
         * its finding (`partly_shown` included), fails the safety hard gate (scorers.ts noChange). Silence on a
         * competency is a gap, never a finding (AGENTS.md 1.6); field match alone ignores an extra finding.
         */
        noChange: z.array(z.string().min(1)).min(1).optional(),
        /** A rubric for the LLM judge, where exact match is not possible. */
        judge: z.string().min(1).optional(),
      })
      .strict(),
    /** The answer a model gave, scored when the run is not live, and the judge's verdict on it. */
    recorded: z
      .object({
        /** The prompt the answer came from (run.ts promptOf): a recorded run fails a case whose prompt has changed since. */
        promptVersion: z.string().min(1).optional(),
        promptHash: z.string().min(1).optional(),
        output: z.unknown(),
        judge: verdict.optional(),
        /**
         * For an expected free-text value the answer words differently (config.ts `meaning`), the answer's value that
         * means the same, or null: the live matcher's verdict, so a recorded run scores it without a model (AIV-P2-083).
         */
        matches: z.record(z.string(), z.string().nullable()).optional(),
        /**
         * For each suggestion in the answer, by name, the rubric point it fails or null: the live suggestion judge's
         * verdicts under its prompt id, so a recorded run scores suggestions without a model (AIV-P2-085).
         */
        suggestions: z
          .object({
            judge: z.string().min(1),
            verdicts: z.record(z.string(), z.enum(suggestionFaults).nullable()),
          })
          .strict()
          .optional(),
      })
      .strict(),
  })
  .strict()
  .refine((c) => !c.expected.judge || c.recorded.judge, 'recorded.judge is required when expected.judge is set')
  // A mistyped id would never match a finding, so the gate would pass whatever the answer.
  .refine(
    (c) => (c.expected.noChange ?? []).every((id) => listedIds(c.input).includes(id)),
    'expected.noChange names a competency id that input.competencies does not list',
  );

export type GoldenCase = z.infer<typeof goldenCase>;

/**
 * The candidate's identifiers for a live run (AIV-P1-080): an evidence case names its candidate first in `people`. The
 * client replaces every email and phone in the sources anyway, so the case needs no record contact of its own.
 */
export const identifiersOf = (golden: GoldenCase) => ({ names: golden.people.slice(0, 1), emails: [], phones: [] });

/**
 * Reads every `<dir>/<task>/*.yaml`, except the gate's own failing fixtures and the judge's golden cases. Throws on the
 * first invalid case.
 */
export function loadGolden(dir: string): Map<string, GoldenCase[]> {
  const tasks = new Map<string, GoldenCase[]>();
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'fixtures' || entry.name === 'judge') continue;
    const files = readdirSync(join(dir, entry.name)).filter((file) => file.endsWith('.yaml'));
    if (files.length === 0) continue;
    tasks.set(
      entry.name,
      files.toSorted().map((file) => {
        const path = join(entry.name, file);
        const parsed = goldenCase.safeParse(parse(readFileSync(join(dir, path), 'utf8')));
        if (!parsed.success) throw new Error(`${path}: ${z.prettifyError(parsed.error)}`);
        if (parsed.data.id !== basename(file, '.yaml')) throw new Error(`${path}: id must equal the file name`);
        return parsed.data;
      }),
    );
  }
  return tasks;
}

/**
 * A judge golden case (AIV-P2-084): an output whose verdict is known, graded against a golden case's rubric and
 * sources, so every judge prompt change is tested on the real model. One YAML file per case in `<dir>/judge/`.
 */
const caseRef = z.string().regex(/^[\w.-]+\/[a-z0-9-]+$/);
const evidenceJudgeCase = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    /** The golden case (`<task>/<id>`) whose rubric, sources and recorded output the judge grades. */
    case: caseRef,
    /** Replaces every link's limit in that output; omitted, the recorded output is graded as it is. */
    limit: z.string().min(1).optional(),
    /** AIV-P1-137: a whole output graded in place of the recorded one, for a task whose output has no links. */
    output: z.record(z.string(), z.unknown()).optional(),
    expected: z.enum(['pass', 'fail']),
    /** The live judge's verdict and the judge prompt it came from: a recorded run refuses one from another prompt. */
    recorded: z.object({ judgePrompt: z.string().min(1), verdict }).strict(),
  })
  .strict()
  .refine((c) => c.limit === undefined || c.output === undefined, 'give a limit or an output, not both');
/**
 * A suggestion judge golden case (AIV-P2-088): a hand-made draft (`<dir>/fixtures/<from>/<task>/<id>.yaml`) and, for
 * each of its suggestions in order, the fault the suggestion judge must give it or null. Its recorded verdicts are the
 * fixture's own `recorded.suggestions`, so they are stored once.
 */
const suggestionJudgeCase = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    judge: z.literal('suggestion'),
    case: caseRef,
    from: z.enum(['failing', 'passing']),
    expected: z.record(z.string(), z.enum(suggestionFaults).nullable()),
  })
  .strict();
/**
 * A matcher golden case (AIV-P1-142): expected texts, the options offered for them, and the option each must get or
 * null. Its recorded verdicts carry the matcher prompt they came from: a recorded run refuses another prompt's.
 */
const matchJudgeCase = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    judge: z.literal('match'),
    options: z.array(z.string().min(1)).min(1),
    expected: z.record(z.string(), z.string().nullable()),
    recorded: z
      .object({ matchPrompt: z.string().min(1), verdicts: z.record(z.string(), z.string().nullable()) })
      .strict(),
  })
  .strict();
type Graded = { golden: GoldenCase; output: unknown };
export type EvidenceJudgeCase = Omit<z.infer<typeof evidenceJudgeCase>, 'output'> & Graded & { rubric: string };
export type SuggestionJudgeCase = z.infer<typeof suggestionJudgeCase> & Graded;
export type MatchJudgeCase = z.infer<typeof matchJudgeCase>;
export type JudgeCase = EvidenceJudgeCase | SuggestionJudgeCase | MatchJudgeCase;

const withLinks = z.object({ links: z.array(z.record(z.string(), z.unknown())) }).loose();
// At least one: a case with nothing to grade would pass without the judge.
const withSuggestions = z.object({ suggestions: z.array(z.object({ name: z.string() }).loose()).min(1) }).loose();

/** Reads every `<dir>/judge/*.yaml` against the golden set `golden`; none when the folder is absent. */
export function loadJudgeCases(dir: string, golden: Map<string, GoldenCase[]>): JudgeCase[] {
  if (!existsSync(join(dir, 'judge'))) return [];
  const fixtures = new Map<string, Map<string, GoldenCase[]>>();
  const fixturesIn = (from: string) =>
    fixtures.get(from) ?? fixtures.set(from, loadGolden(join(dir, 'fixtures', from))).get(from);
  return readdirSync(join(dir, 'judge'))
    .filter((file) => file.endsWith('.yaml'))
    .toSorted()
    .map((file): JudgeCase => {
      const path = join('judge', file);
      const parsed = z
        .union([evidenceJudgeCase, suggestionJudgeCase, matchJudgeCase])
        .safeParse(parse(readFileSync(join(dir, path), 'utf8')));
      if (!parsed.success) throw new Error(`${path}: ${z.prettifyError(parsed.error)}`);
      if (parsed.data.id !== basename(file, '.yaml')) throw new Error(`${path}: id must equal the file name`);
      if ('judge' in parsed.data && parsed.data.judge === 'match') {
        const { options, expected, recorded } = parsed.data;
        const offered = (verdicts: Record<string, string | null>) =>
          Object.values(verdicts).every((option) => option === null || options.includes(option));
        if (!offered(expected) || !offered(recorded.verdicts))
          throw new Error(`${path}: every expected and recorded option must be one of its options`);
        return parsed.data;
      }
      const [task = '', id] = parsed.data.case.split('/');
      if ('judge' in parsed.data) {
        const { from, expected } = parsed.data;
        const target = fixturesIn(from)
          ?.get(task)
          ?.find((c) => c.id === id);
        const drafted = withSuggestions.safeParse(target?.recorded.output);
        if (!target || !drafted.success)
          throw new Error(`${path}: no fixture ${from}/${parsed.data.case} that suggests`);
        // Every suggestion, in order: a miss is reported by its position, and none goes ungraded.
        const names = drafted.data.suggestions.map((s) => s.name);
        if (JSON.stringify(Object.keys(expected)) !== JSON.stringify(names))
          throw new Error(`${path}: expected must name every suggestion of ${from}/${parsed.data.case}, in order`);
        return { ...parsed.data, golden: target, output: target.recorded.output };
      }
      const target = golden.get(task)?.find((c) => c.id === id);
      if (!target?.expected.judge) throw new Error(`${path}: no golden case ${parsed.data.case} with a judge rubric`);
      const { limit } = parsed.data;
      let output = parsed.data.output ?? target.recorded.output;
      if (limit !== undefined) {
        const links = withLinks.safeParse(output);
        if (!links.success) throw new Error(`${path}: ${parsed.data.case} has no links whose limit to replace`);
        output = { ...links.data, links: links.data.links.map((link) => ({ ...link, limit })) };
      }
      return { ...parsed.data, rubric: target.expected.judge, golden: target, output };
    });
}
