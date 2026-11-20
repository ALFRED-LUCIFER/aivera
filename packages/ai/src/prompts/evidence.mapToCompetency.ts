import { z } from 'zod';
import { cited, type Source } from '../citations.ts';

// "Map evidence to competencies" (AIV-P1-027), ADR-006 point 2: the prompt and schema, versioned here so every change
// runs the eval set (evals/evidence.mapToCompetency/). The evidence module calls it; the eval runner calls the same.
// The model only suggests: the evidence module's guards decide the stored strength and provenance, and code alone
// checks each quote (citations.ts).

/** Bump with any change to the system prompt, the prompt or the schema; it is stored on every mapped link. */
export const MAP_TO_COMPETENCY_VERSION = 'evidence.mapToCompetency@1';

export const MAP_TO_COMPETENCY_SYSTEM = [
  "You map a job candidate's evidence to the competencies of the job's approved rubric, listed in the prompt by id.",
  'For each piece of evidence that shows a competency, give: competencyId, copied exactly from the list; one citation',
  'quoting the exact words or numbers the link rests on, as short as still makes sense; strength: strong for real work',
  'whose authorship is clear, medium for real work whose authorship or scale is unclear, supporting for an indirect',
  'signal (a reference, a talk, a public post, a declared dependency, a README mention), claim for a statement with',
  "nothing to inspect; label: claim for the candidate's own statement (a CV line), submitted for work the candidate",
  'gave us to inspect; level: 1 (basic) to 5 (expert), what this evidence alone shows against the competency; limit:',
  'one sentence on what this evidence does not show.',
  'Skill signal lines in a repository source were measured from its files. A declaration (a manifest dependency, a',
  'README mention, code only under test or example folders) is not evidence of using a skill.',
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
