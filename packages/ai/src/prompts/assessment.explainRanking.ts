import { z } from 'zod';
import { citation, sourceLabel, type Source } from '../citations.ts';

// "Explain a ranking" (AIV-P1-033), ADR-006 point 2: three short statements on why a candidate ranks where they do, each
// citing a snapshot fact or an evidence excerpt. The model never writes a number of its own: for the score it writes
// placeholders that the assessment module fills from the snapshot, so "45% of the weight" cannot be invented, and a
// figure of the candidate's work appears only when the statement quotes it from the excerpt it cites (AIV-P1-132, owner
// decision 24 Nov 2026). Versioned here so every change runs the eval set (evals/assessment.explainRanking/). It
// explains an order; it never advises on anyone (AGENTS.md 1.5).

/** Bump with any change to the request the model is sent (its prompt hash): the system prompt, the prompt or the JSON schema. */
export const EXPLAIN_RANKING_VERSION = 'assessment.explainRanking@7';

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
  'When an excerpt of the work is given, one statement says what that work shows, using only what the excerpt states, and cites the excerpt.',
  'That statement ends where the excerpt ends: never add what the work shows about the candidate or how much it matters ("showing',
  'significant contribution", "demonstrating strong skill"). Add nothing a cited source does not state: no judgement of size, importance or',
  'quality such as "significant", "strong", "extensive" or "substantial", and no "entirely", "all" or "including" the facts source does not say.',
  'A statement that cites the facts source is one of its lines, copied exactly as it stands.',
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

// A figure: a run of letters and digits that holds a digit in any script ("412", "p95"), with a separator between two
// digits kept inside it, so "4,120" is not read as the "4" and "120" of another phrase.
const FIGURE = /[\p{L}\p{N}]*\p{N}(?:[.,]\p{N}|[\p{L}\p{N}])*/gu;
// What a figure of the work may never stand beside: a placeholder, or a word for what the snapshot measures.
// Whole words, so a repository called "fraud-scorer" is not one.
const ABOUT_THE_SCORE = /\{\w+\}|\b(?:weight(?:s|ed|ing)?|scor(?:e|es|ed|ing)|competenc\w*|rubric)\b/i;

/**
 * Whether every figure in `text` stands in one of `quotes` (the evidence excerpts the statement cites), in a statement
 * that says nothing of the score: a quoted figure can then never read as a weight, a score or a count of competencies.
 */
export const figuresQuoted = (text: string, quotes: readonly string[]): boolean => {
  const written = text.match(FIGURE) ?? [];
  if (written.length === 0) return true;
  const quoted = new Set(quotes.flatMap((quote) => quote.match(FIGURE) ?? []));
  return !ABOUT_THE_SCORE.test(text) && written.every((figure) => quoted.has(figure));
};

/**
 * Every figure in a statement is one it quotes from an evidence excerpt it cites; the facts source never counts, so a
 * score, weight or count can only be a placeholder (AGENTS.md 1.6, 1.7). The client then checks each quote is in its source.
 */
// shortcut: a statement citing the facts source must copy one of its lines, and the checked line lists names as they
// are, so a checked competency whose name holds a digit ("Python 3"), a number word ("Single sign-on") or a word
// statementAllowed refuses ("Test and verification") makes that job's explanation the template; give the checked names
// a placeholder if a pilot rubric has one.
// shortcut: figures are matched one by one, so "460 of 412 commits" passes on a quote of "412 of 460 commits", and
// nothing at run time catches it (the judge only runs in the eval). Match the quoted phrase if a pilot answer does it.
// This runs on the quotes as the model wrote them; the assessment module runs `figuresQuoted` again on the quotes it
// stores, which redaction may have cut (AIV-P1-132).
const quotesItsFigures = ({ text, citations }: { text: string; citations: { sourceId: string; quote: string }[] }) =>
  figuresQuoted(
    text,
    citations.filter((c) => c.sourceId !== FACTS_LABEL).map((c) => c.quote),
  );

export const explainRankingSchema = z.object({
  statements: z
    .array(
      z
        .object({ text: explainText, citations: z.array(citation) })
        .refine(quotesItsFigures, { path: ['text'], message: 'a figure is quoted from the cited evidence' }),
    )
    .max(3),
});

/**
 * The schema for one request: a statement that cites the facts source is one of its lines, exactly, so a paraphrase
 * cannot say more than the snapshot (AIV-P1-132, owner decision 25 Nov 2026). A refine only: the JSON schema the model
 * is given, and so the prompt hash, do not change.
 */
// The lines as given here: a line the model saw changed (a redacted name, `<` sent as `&lt;`) fails, and the template
// is shown.
// shortcut: a statement citing only an excerpt may still hold {checkedCompetencies} or {claimCompetencies}, which no
// facts line holds; statementAllowed checks its wording, nothing checks it against the snapshot. Hold a statement with a
// placeholder to a facts line too if the owner asks or a pilot answer does it.
const schemaFor = (factsText: string) => {
  const lines = factsText.split('\n');
  return explainRankingSchema.superRefine(({ statements }, ctx) =>
    statements.forEach(({ text, citations }, i) => {
      if (citations.some((c) => c.sourceId === FACTS_LABEL) && !lines.includes(text))
        ctx.addIssue({
          code: 'custom',
          path: ['statements', i, 'text'],
          message: 'a facts line, copied exactly',
          params: { reason: 'facts_line_reworded' },
        });
    }),
  );
};

/** The whole request but its workspace and identifiers: `sources` are the facts source first, then the cited excerpts. */
export const explainRankingRequest = (sources: readonly Source[]) => ({
  task: 'assessment.explainRanking' as const,
  promptVersion: EXPLAIN_RANKING_VERSION,
  system: EXPLAIN_RANKING_SYSTEM,
  prompt: 'Explain the ranking from the facts source and the excerpts.',
  schema: schemaFor(sources[0]?.text ?? ''),
  sources,
});
