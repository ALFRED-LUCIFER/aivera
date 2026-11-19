import { readdirSync, readFileSync } from 'node:fs';
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
    /** Every person the case names; each must be in the synthetic cast. */
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
        /** A rubric for the LLM judge, where exact match is not possible. */
        judge: z.string().min(1).optional(),
      })
      .strict(),
    /** The answer a model gave, scored when the run is not live, and the judge's verdict on it. */
    recorded: z.object({ output: z.unknown(), judge: verdict.optional() }).strict(),
  })
  .strict()
  .refine((c) => !c.expected.judge || c.recorded.judge, 'recorded.judge is required when expected.judge is set');

export type GoldenCase = z.infer<typeof goldenCase>;

/** Reads every `<dir>/<task>/*.yaml`, except the gate's own failing fixtures. Throws on the first invalid case. */
export function loadGolden(dir: string): Map<string, GoldenCase[]> {
  const tasks = new Map<string, GoldenCase[]>();
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'fixtures') continue;
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
