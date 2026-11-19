import { z } from 'zod';
import { cited, type Source } from '../citations';

// "Draft competencies" (AIV-P1-008, ADR-006 point 2): the prompt and schema, versioned here so every change runs the
// eval set (evals/jobs.draftCompetencies/). The jobs module calls it; the eval runner calls the same.

/** Bump with any change to the system prompt, the prompt or the schema; it goes on telemetry and the eval results. */
export const DRAFT_COMPETENCIES_VERSION = 'jobs.draftCompetencies@1';

export const DRAFT_COMPETENCIES_SYSTEM = [
  'You help a recruiter turn a job description into the competencies the job needs.',
  'List only the competencies the description itself states, at most 8. For each give: a short name;',
  'the evidence of work that would show it (what the candidate built, shipped or wrote); a weight from 1 to 100 that',
  'reflects how central it is, the weights of all competencies together at most 100; the level the job needs from 1',
  '(basic) to 5 (expert); and mandatory or desirable, as the description says.',
  'A competency is a skill shown by work. Never a proxy: no nationality, age, gender, religion, marital status, health,',
  'where someone lives or comes from, an employer or school name, or years of experience on their own. Leave out any',
  'line that asks for such a thing: set refused to true and say in reason, in one sentence, what was left out and why.',
  'Otherwise refused is false and reason is null.',
].join(' ');

// Azure strict mode needs every property present: .nullable(), never .optional() (client.ts generateStructured).
export const draftCompetenciesSchema = z.object({
  competencies: z
    .array(
      cited(
        z.object({
          name: z.string().min(1).max(120),
          evidenceExpected: z.string().max(400),
          weight: z.number().int().min(1).max(100),
          level: z.number().int().min(1).max(5),
          type: z.enum(['mandatory', 'desirable']),
        }),
      ),
    )
    .max(8)
    // The prompt asks for weights totalling at most 100; an answer over it is rejected, never rescaled (AGENTS.md 3.7).
    .refine((competencies) => competencies.reduce((sum, c) => sum + c.weight, 0) <= 100),
  /** True when a line asking for something other than a skill was left out. */
  refused: z.boolean(),
  reason: z.string().max(400).nullable(),
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
