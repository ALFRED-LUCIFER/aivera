import { z } from 'zod';
import { cited, type Source } from '../citations.ts';

// "Draft competencies" (AIV-P1-008) and "suggest what it misses" (AIV-P1-009), ADR-006 point 2: the prompt and
// schema, versioned here so every change runs the eval set (evals/jobs.draftCompetencies/). The jobs module calls it;
// the eval runner calls the same.

/** Bump with any change to the system prompt, the prompt or the schema; it goes on telemetry and the eval results. */
export const DRAFT_COMPETENCIES_VERSION = 'jobs.draftCompetencies@3';

export const DRAFT_COMPETENCIES_SYSTEM = [
  'You help a recruiter turn a job description into the competencies the job needs.',
  'List only the competencies the description itself states, never more than 8: when it states more, merge related',
  'ones or keep the 8 most central. For each give: a short name of at most 60 characters; the evidence of work that',
  'would show it (what the candidate built, shipped or wrote) in one sentence of at most 300 characters; a weight',
  'from 1 to 100 for how central it is compared with the others (Credalent scales the weights to total 100, so they',
  'need not add up); the level the job needs from 1 (basic) to 5 (expert); and mandatory or desirable, as the',
  'description says.',
  'A competency is a skill shown by work. Never a proxy: no nationality, age, gender, religion, marital status, health,',
  'where someone lives or comes from, an employer or school name, or years of experience on their own. Leave out any',
  'line that asks for such a thing: set refused to true and say in reason, in one sentence of at most 300 characters,',
  'what was left out and why. Otherwise refused is false and reason is null.',
  'Then suggest at most 2 competencies the job needs that the description does not ask for, such as knowledge of the',
  'industry or market, a language the work is done in, or a skill the work implies. Never repeat a listed competency.',
  'Give each suggestion the same fields, and in why one sentence of at most 300 characters on what in the description',
  'implies it and what the description leaves out; cite the line that implies it. Weigh suggestions against the listed',
  'competencies on the same scale. Suggest none when nothing is missing. Suggestions follow the same rule: never a',
  'proxy. A language is a skill shown by work in it, never being a native speaker, a nationality or a place.',
].join(' ');

const competency = z.object({
  name: z.string().min(1).max(120),
  evidenceExpected: z.string().max(400),
  weight: z.number().int().min(1).max(100),
  level: z.number().int().min(1).max(5),
  type: z.enum(['mandatory', 'desirable']),
});

// Azure strict mode needs every property present: .nullable(), never .optional() (client.ts generateStructured). Azure
// documents maxItems, maxLength, minimum and maximum as unsupported there, so the model is not held to them: the prompt
// states each limit and zod rejects a breach. No weight total is asked for, as a model cannot reliably keep a sum
// across a list (AIV-P1-082): the jobs module scales the weights to 100 with the rule the save applies
// (rebalanceWeights), so the recruiter still sees a draft totalling exactly 100.
export const draftCompetenciesSchema = z.object({
  competencies: z.array(cited(competency)).max(8),
  /** True when a line asking for something other than a skill was left out. */
  refused: z.boolean(),
  reason: z.string().max(400).nullable(),
  /** What the description leaves out (AIV-P1-009); `why` is shown to the recruiter as "Why: …". */
  suggestions: z.array(cited(competency.extend({ why: z.string().min(1).max(400) }))).max(2),
});

/**
 * The whole request but its workspace, so the jobs module and the eval runner send the same thing. Only the job type,
 * title and description reach the model: no candidate and nothing else from the workspace.
 */
export const draftCompetenciesRequest = (input: { jobType: string; title: string }, sources: readonly Source[]) => ({
  task: 'jobs.draftCompetencies' as const,
  promptVersion: DRAFT_COMPETENCIES_VERSION,
  system: DRAFT_COMPETENCIES_SYSTEM,
  prompt: `Job type: ${input.jobType}\nTitle: ${input.title}`,
  schema: draftCompetenciesSchema,
  sources,
});
