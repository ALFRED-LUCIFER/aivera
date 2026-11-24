import { z } from 'zod';
import { citation, sourceLabel, type Source } from '../citations.ts';

// "Explain a ranking" (AIV-P1-033), ADR-006 point 2: three short statements on why a candidate ranks where they do, each
// citing a snapshot fact or an evidence excerpt. The model never writes a number of its own: for the score it writes
// placeholders that the assessment module fills from the snapshot, so "45% of the weight" cannot be invented, and a
// figure of the candidate's work appears only when the statement quotes it from the excerpt it cites (AIV-P1-132, owner
// decision 24 Nov 2026). Versioned here so every change runs the eval set (evals/assessment.explainRanking/). It
// explains an order; it never advises on anyone (AGENTS.md 1.5).

/** Bump with any change to the system prompt, the prompt or the schema. */
export const EXPLAIN_RANKING_VERSION = 'assessment.explainRanking@4';

/** The only placeholders a statement may hold; the assessment module's domain/explain.ts fills each from the snapshot. */
const EXPLAIN_PLACEHOLDERS = [
  'checkedCompetencies',
  'checkedWeight',
  'claimCompetencies',
  'claimWeight',
  'claimNames',
] as const;

const EXPLAIN_RANKING_SYSTEM = [
  "You explain, for a recruiter, why a job candidate's score is what it is, in at most three short statements. Each",
  "statement cites the sources it rests on: the facts source, or an excerpt of the candidate's work. Say only what the",
  'sources show. Work that was independently checked backs a score; a claim with nothing to inspect counts zero.',
  'When an excerpt of the work is given, one statement says what that work shows and cites the excerpt.',
  'Never write a number of your own: no percentage, number word or count word such as "one of", "both", "single", "once" or "third". Where a count, a share of the weight or a list of competencies belongs, write',
  `one of these placeholders instead: ${EXPLAIN_PLACEHOLDERS.map((p) => `{${p}}`).join(', ')}. The facts source already holds them: copy a placeholder exactly as it stands, braces included.`,
  "A figure from an excerpt of the candidate's work (a count, or a term that holds a digit) may appear in a statement only copied exactly, and only when that statement cites the excerpt with a quote that holds the same figure. Never write a percent sign.",
  '{checkedCompetencies} and {checkedWeight} are the competencies backed by independently checked work (with their count and noun) and their share of the',
  'weight; {claimCompetencies}, {claimWeight} and {claimNames} are the competencies that still rest on claims, their share and',
  'their names. Never call anything verified, proven or confirmed: say "independently checked" for work a second source checked, and never say a claim is checked or backed. Use a placeholder only when the facts source has the line it stands for, and say "heaviest" only when it does. Refer to the candidate as "the',
  'candidate" and to work by what it shows, never by name. Never recommend rejecting, advancing or contacting anyone,',
  'and never judge a person on anything but the evidence of their work: a person decides.',
].join(' ');

// Words that state a number, so the model cannot write one in words. "one" is a pronoun too ("no one"): it is rejected only
// as a count of competencies. A percent sign is rejected separately, and a digit by `quotesItsFigures` below.
const NUMBER_WORDS =
  /\b(?:zero|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|(?:hundred|thousand|million|billion|dozen)s?|per\s*cent|percent|half|quarter|third|both|single|once|twice)\b/i;
const ONE_COUNT = /\bone\s+(?:of\b|(?:\w+\s+){0,2}competenc)/i;

const known = (name: string) => EXPLAIN_PLACEHOLDERS.some((p) => p === name);

/** A statement's text holds no percentage or number word and only the placeholders above (AGENTS.md 1.6). */
export const explainText = z
  .string()
  .min(1)
  .refine(
    (text) => !/[%٪％]/u.test(text) && !NUMBER_WORDS.test(text) && !ONE_COUNT.test(text),
    'numbers come from the snapshot',
  )
  .refine(
    (text) => !/[{}]/.test(text.replace(/\{(\w+)\}/g, (all, name: string) => (known(name) ? '' : all))),
    'unknown placeholder',
  );

// A statement may come back with no citation: the assessment module drops it (the ticket's "removed before display"), so
// `citations` is not `cited()`'s min(1), which would reject the whole answer. More than three statements rejects it.
/** The facts source's label: `explainRankingRequest` takes it first. */
const FACTS_LABEL = sourceLabel(0);

/** The figures in a text: each run of letters and digits that holds a digit in any script ("412", "p95"). */
const figures = (text: string) => text.match(/[\p{L}\p{N}]*\p{N}[\p{L}\p{N}]*/gu) ?? [];

/**
 * Every figure in a statement is one it quotes from an evidence excerpt it cites; the facts source never counts, so a
 * score, weight or count can only be a placeholder (AGENTS.md 1.6, 1.7). The client then checks each quote is in its source.
 */
// shortcut: a competency whose name holds a digit ("Python 3") makes the facts line fail when copied, so that job's
// explanation is the template; give the checked names a placeholder if a pilot rubric has one.
// shortcut: figures are matched one by one, so "460 of 412 commits" passes on a quote of "412 of 460 commits"; the live
// judge's rubric ("says only what its source shows") is the backstop. Match the quoted phrase if one slips through.
const quotesItsFigures = ({ text, citations }: { text: string; citations: { sourceId: string; quote: string }[] }) => {
  const quoted = new Set(citations.filter((c) => c.sourceId !== FACTS_LABEL).flatMap((c) => figures(c.quote)));
  return figures(text).every((figure) => quoted.has(figure));
};

export const explainRankingSchema = z.object({
  statements: z
    .array(
      z
        .object({ text: explainText, citations: z.array(citation) })
        .refine(quotesItsFigures, { path: ['text'], message: 'a figure is quoted from the cited evidence' }),
    )
    .max(3),
});

/** The whole request but its workspace and identifiers: `sources` are the facts source first, then the cited excerpts. */
export const explainRankingRequest = (sources: readonly Source[]) => ({
  task: 'assessment.explainRanking' as const,
  promptVersion: EXPLAIN_RANKING_VERSION,
  system: EXPLAIN_RANKING_SYSTEM,
  prompt: 'Explain the ranking from the facts source and the excerpts.',
  schema: explainRankingSchema,
  sources,
});
