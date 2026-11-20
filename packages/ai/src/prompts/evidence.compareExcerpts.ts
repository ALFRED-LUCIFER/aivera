import { z } from 'zod';
import { cited, InvalidCitation, sourceLabel, type Checked, type Source } from '../citations.ts';

// "Compare two excerpts" (AIV-P1-078), ADR-006 point 2: judges the pairs of cited excerpts the evidence module's numeric
// pre-check left `not_settled` ("about 9,000 merchants" against "a few hundred merchants"). Versioned here so every
// change runs the eval set (evals/evidence.compareExcerpts/). The model only flags: a person resolves every
// contradiction, and nothing it returns changes a stage, rejects or contacts anyone (AGENTS.md 1.5).

/** Bump with any change to the system prompt, the prompt or the schema. */
export const COMPARE_EXCERPTS_VERSION = 'evidence.compareExcerpts@1';

export const COMPARE_EXCERPTS_SYSTEM = [
  "You check pairs of excerpts from a job candidate's evidence for contradictions. Each pair in the prompt names two",
  'sources that support the same competency. A pair contradicts when both excerpts state the same fact about the same',
  'work and the two statements cannot both be true: a scale, a count, a size, a duration, a role or an outcome that',
  'differs beyond rounding or vague wording ("about 9,000" against "a few hundred" contradicts; "about 9,000" against',
  '"thousands" does not). Excerpts about different work, different periods or different measures never contradict, and',
  'one excerpt saying less than the other is not a contradiction.',
  'For each pair that contradicts, give one entry in contradictions with exactly two citations: one quoting the',
  "conflicting words of each of the pair's two sources. Leave out every pair that does not contradict; when none does,",
  'leave contradictions empty.',
].join(' ');

// Azure strict mode needs every property present (client.ts generateStructured): an entry is its citations only.
// shortcut: more than 40 flags in one run rejects the answer whole (counted, nothing stored); chunk the pairs per call if
// pilot runs ever come near it.
export const compareExcerptsSchema = z.object({ contradictions: z.array(cited(z.object({}))).max(40) });

/**
 * The whole request but its workspace, so the evidence module and the eval runner send the same thing. Each excerpt is
 * one source, wrapped as untrusted (AIV-P1-070); `pairs` name two source ids each.
 */
export const compareExcerptsRequest = (sources: readonly Source[], pairs: readonly (readonly [string, string])[]) => {
  const label = (id: string) => sourceLabel(sources.findIndex((s) => s.id === id));
  return {
    task: 'evidence.compareExcerpts' as const,
    promptVersion: COMPARE_EXCERPTS_VERSION,
    system: COMPARE_EXCERPTS_SYSTEM,
    prompt: `Pairs to compare:\n${pairs.map(([a, b]) => `- ${label(a)} and ${label(b)}`).join('\n')}`,
    schema: compareExcerptsSchema,
    sources,
  };
};

/**
 * The indexes into `pairs` the checked answer flags. A flag must cite exactly the two sources of one requested pair;
 * anything else rejects the whole answer (InvalidCitation), never patched up (AGENTS.md 3.7). It runs after the
 * client's call, so it gets no retry: the evidence module counts the rejection and stores nothing.
 */
export function flaggedPairs(
  answer: Checked<z.infer<typeof compareExcerptsSchema>>,
  pairs: readonly (readonly [string, string])[],
): number[] {
  const flagged = answer.contradictions.map(({ citations }) => {
    const ids = new Set(citations.map((c) => c.sourceId));
    const pair = pairs.findIndex(([a, b]) => a !== b && ids.size === 2 && ids.has(a) && ids.has(b));
    if (pair < 0) throw new InvalidCitation('evidence.compareExcerpts', 'a source', 'not a requested pair');
    return pair;
  });
  return [...new Set(flagged)];
}
