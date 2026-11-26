import { z } from 'zod';
import { cited, sourceLabel, type Source } from '../citations.ts';

// "The trade-offs" on the comparison page (AIV-P1-047), ADR-006 point 2: for each compared candidate, the model picks
// up to three things worth reading first, by citing them: lines of that candidate's facts source, which the assessment
// module writes from the snapshots ("is the only one compared with …"), and excerpts of their cited work. It writes no
// sentence of its own. `keptTradeoffs` shows each pick as it stands in its source: a live run (26 Nov 2026) reworded
// copied facts lines, and prose about a piece of work could carry a comparison or advice no rule here could hold back
// (code review, AIV-P1-047). Versioned here so every change runs the eval set (evals/assessment.compareTradeoffs/).
// It points at evidence; it never advises on anyone (AGENTS.md 1.5).

/** Bump with any change to the request the model is sent (its prompt hash): the system prompt, the prompt or the JSON schema. */
export const COMPARE_TRADEOFFS_VERSION = 'assessment.compareTradeoffs@1';

const COMPARE_TRADEOFFS_SYSTEM = [
  'You help a recruiter who compares job candidates side by side to see the trade-offs between them. Each candidate has',
  'a key, a facts source and, for some, excerpts of their work. You write no sentence of your own: for every candidate',
  "you pick one to three statements, and each statement is one citation of one of that candidate's own sources.",
  "Pick first the line of the candidate's facts source that sets them apart from the other candidates, then a line",
  'that says what is still open. To pick a facts line, quote that whole line exactly as it stands.',
  'When a candidate has excerpts of their work, also pick the one that best shows the work behind their facts, by',
  'quoting it in full. Never pick the same line or excerpt twice. Judge nobody on anything but the evidence of their work.',
].join(' ');

/** One compared candidate's sources: the facts source first, then the excerpts of their cited work. */
export type TradeoffGroup = readonly [facts: Source, ...excerpts: Source[]];

/** The key the model names a candidate by; names never reach it (ADR-006 point 7). */
const candidateKey = (index: number) => `C${index + 1}`;

export const compareTradeoffsSchema = z.object({
  candidates: z
    .array(
      z.object({
        candidate: z.string(),
        statements: z
          .array(cited(z.object({})))
          .min(1)
          .max(3),
      }),
    )
    .min(2),
});

/** The facts line a quote picks: the only line that holds it; none when no line or more than one does. */
const lineOf = (lines: readonly string[], quote: string) => {
  const holding = lines.filter((line) => quote.trim() !== '' && line.includes(quote.trim()));
  return holding.length === 1 ? holding[0] : undefined;
};

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
        const path = ['candidates', c, 'statements', s, 'citations'];
        // SAFETY: nothing said of one candidate rests on another candidate's evidence.
        if (citations.some((cite) => !own.labels.has(cite.sourceId))) return issue(path, 'cites_another_candidate');
        const ofFacts = citations.filter((cite) => cite.sourceId === own.facts);
        if (ofFacts.some((cite) => !lineOf(own.lines, cite.quote))) issue(path, 'facts_line_unknown');
      }),
    );
  });
};

/**
 * The answer as the product keeps it, from the checked answer of the same `groups`: each citation becomes one
 * statement whose text is what it picks, as it stands in the source. A citation of a candidate's facts source is the
 * one facts line that holds its quote, whole; a citation of an excerpt is that excerpt, whole, whatever part the model
 * quoted (a part could change what it says). Nothing is said twice. The eval scores this, as the assessment module
 * shows it.
 */
// SAFETY: no word shown is the model's: a comparison is the facts line as the assessment module wrote it, and what is
// said of a piece of work is that work's own cited excerpt.
export function keptTradeoffs(
  answer: { candidates: { statements: { citations: { sourceId: string; quote: string }[] }[] }[] },
  groups: readonly TradeoffGroup[],
) {
  return answer.candidates.map(({ statements }, i) => {
    const [facts, ...excerpts] = groups[i] ?? [];
    const said = new Set<string>();
    return {
      candidate: candidateKey(i),
      statements: statements
        .flatMap(({ citations }) => citations)
        .flatMap(({ sourceId, quote }) => {
          const text =
            sourceId === facts?.id
              ? lineOf(facts.text.split('\n'), quote)
              : excerpts.find((excerpt) => excerpt.id === sourceId)?.text;
          if (!text || said.has(text)) return [];
          said.add(text);
          return [{ text, citations: [{ sourceId, quote: text }] }];
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
    prompt: `Pick the trade-offs between these candidates, in this order.\n${listed.join('\n')}`,
    schema: schemaFor(groups),
    sources,
  };
};
