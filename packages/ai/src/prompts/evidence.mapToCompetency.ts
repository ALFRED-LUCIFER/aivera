import { z } from 'zod';
import { cited, type Source } from '../citations.ts';

// "Map evidence to competencies" (AIV-P1-027), ADR-006 point 2: the prompt and schema, versioned here so every change
// runs the eval set (evals/evidence.mapToCompetency/). The evidence module calls it; the eval runner calls the same.
// The model only suggests: the evidence module's guards decide the stored strength and provenance, and code alone
// checks each quote (citations.ts).

/** Bump with any change to the system prompt, the prompt or the schema; it is stored on every mapped link. */
export const MAP_TO_COMPETENCY_VERSION = 'evidence.mapToCompetency@5';
// @5 (AIV-P1-157): a CV line that only rates the candidate maps at level 1 however it is worded; a link's quote names the
// competency's own subject, never a neighbouring practice; a cv source is rule 1 whatever its layout (on @4 a CV laid
// out one fragment per line was labelled submitted and rated Strong in about half the live runs).
// @4 (AIV-P1-156): a link whose quote is not in its source is dropped and counted, not the whole answer. On @3 a CV laid
// out one fragment per line had its whole mapping rejected on both attempts in about half the live runs.

// shortcut: "at most 12 words, from a single line" is advice the model may break (recorded quotes span lines); nothing
// enforces it and a stored excerpt may be multi-line. Enforce it in checkOutput if long excerpts hurt the profile.
export const MAP_TO_COMPETENCY_SYSTEM = [
  "You map a job candidate's evidence to the competencies of the job's approved rubric, listed in the prompt by id.",
  'For each piece of evidence that shows a competency, give: competencyId, copied exactly from the list; one citation',
  'quoting the few words or numbers the link rests on (at most 12 words), from a single line, copied as one unbroken',
  'run exactly as written, never shortened with "..." or joined from separate places; strength and label by the',
  'rules below;',
  'level: 1 (basic) to 5 (expert), the work this evidence alone shows against the competency; limit: one sentence on',
  'what this evidence does not show, such as who reviewed the work, its scale or its effect.',
  'A CV line that only rates the candidate\'s own skill or knowledge and names no work done with it ("Expert in X",',
  '"proficient in X", "excellent knowledge of X", a skill bar) is level 1, however confident its wording; only work',
  'the line names (a suite built, tests run, a defect found, a service shipped) raises a level.',
  'Link a line only to a competency whose own subject (its skill, tool or kind of work) the quoted words name: a',
  'neighbouring practice is not that subject (a code review habit is not a static analysis tool, building a',
  'dashboard is not data modelling, on-call duty is not capacity planning).',
  'A quote never contains a placeholder ([CANDIDATE], [EMAIL_1], [PHONE_1]): for "[CANDIDATE] wrote the scorer", quote',
  '"wrote the scorer".',
  'Strength, by the first rule that fits the sources the link cites. The kind attribute of a source decides, never',
  'its wording or layout: a source with kind="cv" is always rule 1, even when it is broken into short lines, lists',
  'figures or reads like a report of shipped work.',
  '1. Every citation of the link is in a cv source (judge each link by its own citations, even when other sources',
  'exist): "strength": "supporting" with "label": "claim", however the CV line is worded.',
  '2. A source that is not a CV, written by the candidate in the first person, that only describes themselves ("I am',
  'an expert", "I evaluate every release"): "strength": "claim" with "label": "claim".',
  '3. A repository: first, when its skill signal line says declaration_only, or it only declares the skill (a manifest',
  'dependency, a README mention, code only under test or example folders), "supporting", whatever its commits;',
  'otherwise, from "authored A of B commits", "strong" when A is more than half of B (148 of 171) and "medium" when',
  'not (140 of 410). A skill signal grades the code, not who wrote it, and never raises this. Label "submitted".',
  "4. A document that is itself the candidate's work, open to inspection (a requirements document, design or report",
  'they wrote, a shipped product, a portal submission): "medium", label "submitted".',
  '5. Any other indirect signal (a reference, a talk, a public post, a write-up about the work): "supporting", label',
  '"submitted".',
  'Only rules 1 and 2 give label "claim": a document that speaks of [CANDIDATE] in the third person is "submitted".',
  "A repository's file paths show what its code does; its name alone is never evidence of a competency.",
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
 * the workspace's own text; every candidate source goes in `sources`, wrapped as untrusted (AIV-P1-070). A link citing
 * text not in its source is dropped, never re-quoted, and the rest kept (`dropInvalidCitations`); a schema error still
 * rejects the whole answer.
 */
export const mapToCompetencyRequest = (competencies: readonly RubricCompetencyInput[], sources: readonly Source[]) => ({
  task: 'evidence.mapToCompetency' as const,
  promptVersion: MAP_TO_COMPETENCY_VERSION,
  system: MAP_TO_COMPETENCY_SYSTEM,
  prompt: `Competencies:\n${competencies.map((c) => `- ${c.id}: ${c.name}. Evidence expected: ${c.evidenceExpected}`).join('\n')}`,
  schema: mapToCompetencySchema,
  sources,
  dropInvalidCitations: true,
});
