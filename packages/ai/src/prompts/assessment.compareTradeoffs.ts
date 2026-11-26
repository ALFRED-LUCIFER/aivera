import { z } from 'zod';
import { cited, sourceLabel, type Source } from '../citations.ts';
import { explainText, figuresQuoted } from './assessment.explainRanking.ts';

// "The trade-offs" on the comparison page (AIV-P1-047), ADR-006 point 2: for each compared candidate, up to three short
// statements on what sets their evidence apart and what is still open, each citing that candidate's own facts source or
// an excerpt of their work. The assessment module writes the facts lines from the snapshots, so a comparison ("the only
// one compared with …") is never the model's: for a facts statement the model only picks a line by quoting it, and
// `keptTradeoffs` shows that line as written, whatever the model's own wording (it rewords a copied line, live run of
// 26 Nov 2026). As in a ranking explanation (AIV-P1-132), the model writes no number. Versioned here so every change
// runs the eval set (evals/assessment.compareTradeoffs/). It describes evidence; it never advises on anyone (AGENTS.md 1.5).

/** Bump with any change to the request the model is sent (its prompt hash): the system prompt, the prompt or the JSON schema. */
export const COMPARE_TRADEOFFS_VERSION = 'assessment.compareTradeoffs@1';

const COMPARE_TRADEOFFS_SYSTEM = [
  'You describe, for a recruiter comparing job candidates side by side, the trade-offs between them. Each candidate has',
  'a key, a facts source and, for some, excerpts of their work. For every candidate write one to three short statements,',
  "each citing only that candidate's own sources. A statement cites the facts source or an excerpt, never both.",
  "Choose first the line of the candidate's facts source that sets them apart from the others, then what is still open.",
  'A statement that cites a facts source is one of its lines, copied exactly as it stands, and its citation quotes that whole line.',
  'When a candidate has an excerpt of their work, one of their statements says what that work shows and cites the excerpt.',
  'It is a full sentence of its own that starts with a capital letter and uses only what the excerpt states: its subject is',
  'the work as the excerpt names it, or "the candidate" only for what the excerpt says the candidate did.',
  'Add nothing a cited source does not state: no judgement of size, importance or quality such as',
  '"significant", "strong", "extensive" or "substantial".',
  'Never write a number of your own: no percentage, number word or count word such as "both", "single" or "twice".',
  "A figure from an excerpt of the candidate's work may appear in a statement only copied exactly, and only when that",
  'statement cites the excerpt with a quote that holds the same figure.',
  'Never call anything verified, proven or confirmed. Never name a candidate, and never say who is better, who to',
  'choose, reject, advance or contact: a person decides. Judge nobody on anything but the evidence of their work.',
].join(' ');

/** One compared candidate's sources: the facts source first, then the excerpts of their cited work. */
export type TradeoffGroup = readonly [facts: Source, ...excerpts: Source[]];

/** The key the model names a candidate by; names never reach it (ADR-006 point 7). */
export const candidateKey = (index: number) => `C${index + 1}`;

export const compareTradeoffsSchema = z.object({
  candidates: z
    .array(
      z.object({
        candidate: z.string(),
        statements: z
          .array(cited(z.object({ text: z.string().min(1) })))
          .min(1)
          .max(3),
      }),
    )
    .min(2),
});

/** The facts line a quote picks: the one line that holds it. */
const lineOf = (lines: readonly string[], quote: string) => lines.find((line) => line.includes(quote.trim()));

/**
 * The schema for one request: every candidate answered once and in order, each statement citing only its own
 * candidate's sources, and a facts citation quoting one facts line. Refines only: the JSON schema the model is given,
 * and so the prompt hash, do not change.
 */
const schemaFor = (groups: readonly TradeoffGroup[]) => {
  let next = 0;
  const owned = groups.map(([facts, ...excerpts]) => {
    const labels = [facts, ...excerpts].map(() => sourceLabel(next++));
    return { facts: labels[0], labels: new Set(labels), lines: facts.text.split('\n') };
  });
  return compareTradeoffsSchema.superRefine(({ candidates }, ctx) => {
    const issue = (path: PropertyKey[], reason: string) =>
      ctx.addIssue({ code: 'custom', path, message: reason, params: { reason } });
    // SAFETY: a comparison that leaves a candidate out, or says something of them twice, is not shown (AGENTS.md 1.5).
    if (candidates.map((c) => c.candidate).join() !== groups.map((_, i) => candidateKey(i)).join())
      issue(['candidates'], 'every_candidate_once');
    candidates.forEach(({ statements }, c) =>
      statements.forEach(({ citations }, s) => {
        const own = owned[c];
        if (!own) return;
        const path = ['candidates', c, 'statements', s, 'text'];
        // SAFETY: nothing said of one candidate rests on another candidate's evidence.
        if (citations.some((cite) => !own.labels.has(cite.sourceId))) return issue(path, 'cites_another_candidate');
        const ofFacts = citations.filter((cite) => cite.sourceId === own.facts);
        // A facts statement's text is not checked: `keptTradeoffs` shows the quoted line, never the model's wording.
        if (ofFacts.some((cite) => !lineOf(own.lines, cite.quote))) issue(path, 'facts_line_unknown');
      }),
    );
  });
};

// Rule 1.6: nothing the model writes of the work calls it verified, proven or confirmed.
const OVERSTATES = /\bverif|\bproven\b|\bconfirm/i;

/**
 * The answer as the product keeps it, from the checked answer of the same `groups`: a statement citing a candidate's
 * facts source becomes the facts line its quote picks, word for word, citing that line only (a line picked twice is
 * said once). A statement about the work is kept as written unless it holds a number of the model's own (a percentage,
 * a number word, a figure its cited quotes do not hold), a placeholder, or calls the work verified, proven or
 * confirmed: it is then left out. The eval scores this, as the assessment module shows it.
 */
// shortcut: a statement about the work that names a competency with a digit or a number word ("Python 3", "Single
// sign-on") is left out by the number rule; facts lines are never held to it.
// SAFETY: what compares candidates is the facts line as the assessment module wrote it, never the model's wording.
export function keptTradeoffs(
  answer: { candidates: { statements: { text: string; citations: { sourceId: string; quote: string }[] }[] }[] },
  groups: readonly TradeoffGroup[],
) {
  return answer.candidates.map(({ statements }, i) => {
    const facts = groups[i]?.[0];
    const said = new Set<string>();
    return {
      candidate: candidateKey(i),
      statements: statements.flatMap(({ text, citations }) => {
        const picked = facts && citations.find((cite) => cite.sourceId === facts.id);
        if (!picked) {
          // One stray statement about the work is left out; the candidate's other statements stand.
          const allowed =
            explainText.safeParse(text).success &&
            !/[{}]/.test(text) &&
            !OVERSTATES.test(text) &&
            figuresQuoted(
              text,
              citations.map((cite) => cite.quote),
            );
          return allowed ? [{ text, citations: citations.map(({ sourceId, quote }) => ({ sourceId, quote })) }] : [];
        }
        const line = lineOf(facts.text.split('\n'), picked.quote);
        if (!line || said.has(line)) return [];
        said.add(line);
        return [{ text: line, citations: [{ sourceId: facts.id, quote: line }] }];
      }),
    };
  });
}

/** The whole request but its workspace and identifiers: each group is one candidate, in the order they are compared. */
export const compareTradeoffsRequest = (groups: readonly TradeoffGroup[]) => {
  const sources = groups.flat();
  let next = 0;
  const listed = groups.map((group, i) => {
    const [facts, ...excerpts] = group.map(() => sourceLabel(next++));
    return `${candidateKey(i)}: facts ${facts}${excerpts.length ? `, excerpts ${excerpts.join(', ')}` : ''}.`;
  });
  return {
    task: 'assessment.compareTradeoffs' as const,
    promptVersion: COMPARE_TRADEOFFS_VERSION,
    system: COMPARE_TRADEOFFS_SYSTEM,
    prompt: `Describe the trade-offs between these candidates, in this order.\n${listed.join('\n')}`,
    schema: schemaFor(groups),
    sources,
  };
};
