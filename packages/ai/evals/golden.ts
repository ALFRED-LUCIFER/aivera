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
      })
      .strict(),
  })
  .strict()
  .refine((c) => !c.expected.judge || c.recorded.judge, 'recorded.judge is required when expected.judge is set');

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
const judgeCase = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    /** The golden case (`<task>/<id>`) whose rubric, sources and recorded output the judge grades. */
    case: z.string().regex(/^[\w.-]+\/[a-z0-9-]+$/),
    /** Replaces every link's limit in that output; omitted, the recorded output is graded as it is. */
    limit: z.string().min(1).optional(),
    expected: z.enum(['pass', 'fail']),
    /** The live judge's verdict and the judge prompt it came from: a recorded run refuses one from another prompt. */
    recorded: z.object({ judgePrompt: z.string().min(1), verdict }).strict(),
  })
  .strict();
export type JudgeCase = z.infer<typeof judgeCase> & { rubric: string; golden: GoldenCase; output: unknown };

const withLinks = z.object({ links: z.array(z.record(z.string(), z.unknown())) }).loose();

/** Reads every `<dir>/judge/*.yaml` against the golden set `golden`; none when the folder is absent. */
export function loadJudgeCases(dir: string, golden: Map<string, GoldenCase[]>): JudgeCase[] {
  if (!existsSync(join(dir, 'judge'))) return [];
  return readdirSync(join(dir, 'judge'))
    .filter((file) => file.endsWith('.yaml'))
    .toSorted()
    .map((file) => {
      const path = join('judge', file);
      const parsed = judgeCase.safeParse(parse(readFileSync(join(dir, path), 'utf8')));
      if (!parsed.success) throw new Error(`${path}: ${z.prettifyError(parsed.error)}`);
      if (parsed.data.id !== basename(file, '.yaml')) throw new Error(`${path}: id must equal the file name`);
      const [task = '', id] = parsed.data.case.split('/');
      const target = golden.get(task)?.find((c) => c.id === id);
      if (!target?.expected.judge) throw new Error(`${path}: no golden case ${parsed.data.case} with a judge rubric`);
      const { limit } = parsed.data;
      let output = target.recorded.output;
      if (limit !== undefined) {
        const links = withLinks.safeParse(output);
        if (!links.success) throw new Error(`${path}: ${parsed.data.case} has no links whose limit to replace`);
        output = { ...links.data, links: links.data.links.map((link) => ({ ...link, limit })) };
      }
      return { ...parsed.data, rubric: target.expected.judge, golden: target, output };
    });
}
