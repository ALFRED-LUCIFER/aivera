import { z } from 'zod';
import { cited, type Source } from '../citations.ts';

// "Map evidence to competencies" (AIV-P1-027), ADR-006 point 2: the prompt and schema, versioned here so every change
// runs the eval set (evals/evidence.mapToCompetency/). The evidence module calls it; the eval runner calls the same.
// The model only suggests: the evidence module's guards decide the stored strength and provenance, and code alone
// checks each quote (citations.ts).

/** Bump with any change to the system prompt, the prompt or the schema; it is stored on every mapped link. */
export const MAP_TO_COMPETENCY_VERSION = 'evidence.mapToCompetency@3';

export const MAP_TO_COMPETENCY_SYSTEM = [
  "You map a job candidate's evidence to the competencies of the job's approved rubric, listed in the prompt by id.",
  'For each piece of evidence that shows a competency, give: competencyId, copied exactly from the list; one citation',
  'quoting the few words or numbers the link rests on (at most 12 words), from a single line, copied as one unbroken run exactly as',
  'written, never shortened with "..." or joined from separate places; strength and label by the rules below;',
  'level: 1 (basic) to 5 (expert), what this evidence alone shows against the competency; limit: one sentence on what',
  'this evidence does not show, such as who reviewed the work, its scale or its effect.',
  'A quote never contains a placeholder ([CANDIDATE], [EMAIL_1], [PHONE_1]): for "[CANDIDATE] wrote the scorer", quote',
  '"wrote the scorer".',
  'Strength, by the first rule that fits the sources the link cites:',
  '1. Every citation of the link is in a cv source (judge each link by its own citations, even when other sources',
  'exist): "strength": "supporting" with "label": "claim", however the CV line is worded, and the limit says the CV',
  'line has nothing to inspect.',
  '2. A source that is not a CV, written by the candidate in the first person, that only describes themselves ("I am',
  'an expert", "I evaluate every release"): "strength": "claim" with "label": "claim".',
  '3. A repository: first, when its skill signal line says declaration_only, or it only declares the skill (a manifest',
  'dependency, a README mention, code only under test or example folders), "supporting", whatever its commits;',
  'otherwise, from "authored A of B commits", "strong" when A is more than half of B (148 of 171) and "medium" when',
  'not (140 of 410). A skill signal grades the code, not who wrote it, and never raises this. Label "submitted".',
  '4. Any other indirect signal (a reference, a talk, a public post, a write-up): "supporting", label "submitted".',
  'Only rules 1 and 2 give label "claim": a document that speaks of [CANDIDATE] in the third person is "submitted".',
  "A repository's name and file paths show what the work is about.",
  'Never map a competency nothing in the sources shows, and never treat a competency as shown because nothing',
  'contradicts it.',
  'Then, in changes, give at most 3 concrete checks or pieces of evidence that would most raise confidence in this',
  'mapping, each naming the competencyId it is about, in one sentence; leave changes empty when every competency is',
  'shown by strong evidence.',
].join(' ');

const link = z.object({
  competencyId: z.string().min(1).max(64),
  strength: z.enum(['strong', 'medium', 'supporting', 'claim']),
  label: z.enum(['submitted', 'claim']),
  level: z.number().int().min(1).max(5),
  // A limit with no words would leave the link stating nothing about what it does not show.
  limit: z.string().min(1).max(300).regex(/\S/),
});

// Azure strict mode needs every property present: .nullable(), never .optional() (client.ts generateStructured).
// `changes` allows more than the 3 asked for: the evidence module ranks them and keeps 3, so a fourth rejects nothing.
export const mapToCompetencySchema = z.object({
  links: z.array(cited(link)).max(40),
  changes: z.array(z.object({ competencyId: z.string().min(1).max(64), text: z.string().min(1).max(300) })).max(10),
});

export type RubricCompetencyInput = { id: string; name: string; evidenceExpected: string };

/**
 * The whole request but its workspace, so the evidence module and the eval runner send the same thing. The rubric is
 * the workspace's own text; every candidate source goes in `sources`, wrapped as untrusted (AIV-P1-070).
 */
export const mapToCompetencyRequest = (competencies: readonly RubricCompetencyInput[], sources: readonly Source[]) => ({
  task: 'evidence.mapToCompetency' as const,
  promptVersion: MAP_TO_COMPETENCY_VERSION,
  system: MAP_TO_COMPETENCY_SYSTEM,
  prompt: `Competencies:\n${competencies.map((c) => `- ${c.id}: ${c.name}. Evidence expected: ${c.evidenceExpected}`).join('\n')}`,
  schema: mapToCompetencySchema,
  sources,
});
