import { z } from 'zod';
import { citation, type Source } from '../citations.ts';

// "Explain a ranking" (AIV-P1-033), ADR-006 point 2: three short statements on why a candidate ranks where they do, each
// citing a snapshot fact or an evidence excerpt. The model never writes a number: it writes placeholders that the
// assessment module fills from the snapshot, so "45% of the weight" cannot be invented. Versioned here so every change
// runs the eval set (evals/assessment.explainRanking/). It explains an order; it never advises on anyone (AGENTS.md 1.5).

/** Bump with any change to the system prompt, the prompt or the schema. */
export const EXPLAIN_RANKING_VERSION = 'assessment.explainRanking@1';

/** The only placeholders a statement may hold; the assessment module's domain/explain.ts fills each from the snapshot. */
export const EXPLAIN_PLACEHOLDERS = [
  'checkedCount',
  'checkedWeight',
  'claimCount',
  'claimWeight',
  'claimNames',
] as const;

export const EXPLAIN_RANKING_SYSTEM = [
  "You explain, for a recruiter, why a job candidate's score is what it is, in at most three short statements. Each",
  "statement cites the sources it rests on: the facts source, or an excerpt of the candidate's work. Say only what the",
  'sources show. Work that was independently checked backs a score; a claim with nothing to inspect counts zero.',
  'Never write a digit or a number word. Where a count, a share of the weight or a list of competencies belongs, write',
  `one of these placeholders instead: ${EXPLAIN_PLACEHOLDERS.map((p) => `{${p}}`).join(', ')}.`,
  '{checkedCount} and {checkedWeight} are the competencies backed by independently checked work and their share of the',
  'weight; {claimCount}, {claimWeight} and {claimNames} are the competencies that still rest on claims, their share and',
  'their names. Use a placeholder only when the facts source has the line it stands for, and say "heaviest" only when it does. Refer to the candidate as "the',
  'candidate" and to work by what it shows, never by name. Never recommend rejecting, advancing or contacting anyone,',
  'and never judge a person on anything but the evidence of their work: a person decides.',
].join(' ');

// Words that state a number. "one" is left out: it is also a pronoun ("no one"); a digit or percent sign is caught anyway.
const NUMBER_WORDS =
  /\b(?:zero|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|percent|half|quarter|third|dozen)\b/i;

const known = (name: string) => EXPLAIN_PLACEHOLDERS.some((p) => p === name);

/** A statement's text holds no number the model wrote and only the placeholders above (AGENTS.md 1.6). */
export const explainText = z
  .string()
  .min(1)
  .refine((text) => !/\d/.test(text) && !NUMBER_WORDS.test(text), 'numbers come from the snapshot')
  .refine(
    (text) => !/[{}]/.test(text.replace(/\{(\w+)\}/g, (all, name: string) => (known(name) ? '' : all))),
    'unknown placeholder',
  );

// A statement may come back with no citation: the assessment module drops it (the ticket's "removed before display"), so
// `citations` is not `cited()`'s min(1), which would reject the whole answer. More than three statements rejects it.
export const explainRankingSchema = z.object({
  statements: z.array(z.object({ text: explainText, citations: z.array(citation) })).max(3),
});

/** The whole request but its workspace and identifiers: the facts and the cited excerpts are `sources`. */
export const explainRankingRequest = (sources: readonly Source[]) => ({
  task: 'assessment.explainRanking' as const,
  promptVersion: EXPLAIN_RANKING_VERSION,
  system: EXPLAIN_RANKING_SYSTEM,
  prompt: 'Explain the ranking from the facts source and the excerpts.',
  schema: explainRankingSchema,
  sources,
});
