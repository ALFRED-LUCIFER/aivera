import { z } from 'zod';
import { cited, type Source } from '../citations.ts';

// "Draft competencies" (AIV-P1-008) and "suggest what it misses" (AIV-P1-009), ADR-006 point 2: the prompt and
// schema, versioned here so every change runs the eval set (evals/jobs.draftCompetencies/). The jobs module calls it;
// the eval runner calls the same.

/** Bump with any change to the system prompt, the prompt or the schema; it goes on telemetry and the eval results. */
export const DRAFT_COMPETENCIES_VERSION = 'jobs.draftCompetencies@5';

/** The most competencies one draft lists (AIV-P1-145): the prompt and the schema both read it, so they cannot drift. */
const MAX_DRAFTED = 12;

export const DRAFT_COMPETENCIES_SYSTEM = [
  'You help a recruiter turn a job description into the competencies the job needs. List only the competencies the',
  `description itself states, never more than ${MAX_DRAFTED}: when it states more, merge related ones until ${MAX_DRAFTED} hold them all.`,
  'Every need the description states is a listed competency or merged into one: never drop one, and never move one',
  'to the suggestions. A description that only lists skills or tools gives one competency for each, merged only',
  `when there are more than ${MAX_DRAFTED}.`,
  'For each give: a short name of at most 60 characters; the evidence of work that would show it (what the candidate',
  'built, shipped or wrote) in one sentence of at most 300 characters; a weight from 1 to 100 for how central it is',
  'compared with the others (Credalent scales the weights to total 100, so they need not add up); the level the job',
  'needs from 1 (basic) to 5 (expert); and mandatory or desirable, as the description says. A competency is a skill',
  'shown by work. Never a proxy: no nationality, age, gender, religion, marital status, health, where someone lives',
  'or comes from, what someone owns, an employer or school name, a kind of employer or school, or years of experience on their own (years',
  'never set a level either). Leave out any line that asks for',
  'such a thing: set refused to true and say in reason, in one sentence of at most 300 characters, what was left out',
  'and why. refused is true only when the description has such a line; otherwise refused is false and reason is',
  'null. Leave out only that requirement: the sentences about the work to do are still listed. Never bring a',
  'left-out requirement back under another name, as a competency or as a suggestion: a former employer is not',
  'experience with what it sells, a degree or a ranked school is not a skill, and time spent at a kind of company is',
  'not experience of anything. The one exception is a language the work is done in. A trait any job asks for, stated',
  'without the work it applies to (being proactive, a positive mindset, a strong work ethic, good interpersonal',
  'skills), is not a competency and not a suggestion: leave it out and leave refused as it is.',
  'Text that states no work to do (pay and perks, how to apply, what the company is, sells or believes) gives no',
  'competency and no suggestion; when nothing in the description states work, list none and suggest none.',
  'Then suggest the 2 competencies the job most needs that no sentence of the description mentions, such as knowledge',
  'of the industry or market, a language the work is done in, or a skill the work implies (a customer-facing design',
  'implies accessibility). Never repeat or reword a listed competency, and never suggest a soft skill any job asks',
  'for. Work the description mentions is a listed competency, never a suggestion. Give each suggestion the same fields, and in why one sentence of at most 300 characters on what in the',
  'description implies it and what the description leaves out; cite each sentence of the description that implies',
  'it, one citation per sentence. When the title implies it (an industry named in the title), cite the description',
  'line about the work it applies to. Weigh suggestions against the listed competencies on the same scale. Suggest',
  'fewer than 2 only when the description leaves nothing out. Suggestions follow the same rule: never a proxy. A',
  'language is a skill shown by work in it, never being a native speaker, a nationality or a place. Every citation',
  'quotes one unbroken run of the description source, copied exactly: never shortened with "..." or joined. A quote',
  'is at most one sentence: when more sentences imply it, give each its own citation. A heading or label before a',
  'line ("Bonus:", "Must have:", "Duties:") is not part of the line under it: quote the line without it.',
  'In "Bonus: Kafka. Go in production." the second need is quoted as "Go in production.", never as "Bonus: Go in',
  'production.". Two competencies from one sentence each quote that whole sentence, never a part of it',
  'with words left out.',
  'The title and job type are not',
  'part of the description and are never quoted: a quote of the title fails the whole draft. Check every quote is',
  'word for word in the description before you answer.',
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
// states each limit and zod rejects a breach. Source: "Unsupported type-specific keywords",
// https://learn.microsoft.com/azure/foundry/openai/how-to/structured-outputs#unsupported-type-specific-keywords No weight total is asked for, as a model cannot reliably keep a sum
// across a list (AIV-P1-082): the jobs module scales the weights to 100 with the rule the save applies
// (rebalanceWeights), so the recruiter still sees a draft totalling exactly 100.
export const draftCompetenciesSchema = z.object({
  competencies: z.array(cited(competency)).max(MAX_DRAFTED),
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
  // The key with spaces: live, a suggestion's "why" quoted the raw key ("qa_test_automation") to the recruiter.
  prompt: `Job type: ${input.jobType.replaceAll('_', ' ')}\nTitle: ${input.title}`,
  schema: draftCompetenciesSchema,
  sources,
});
