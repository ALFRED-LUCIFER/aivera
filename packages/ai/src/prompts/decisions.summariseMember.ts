import { z } from 'zod';
import { cited, sourceLabel, type Source } from '../citations.ts';
import { NUMBER_WORDS, ONE_COUNT } from './assessment.explainRanking.ts';

// "A pack member's strengths, risks, Round 1 finding and recommendation" (AIV-P2-011), ADR-006 point 2: what the
// hiring owner reads on a decision pack's card, each statement citing the snapshot's facts or an excerpt of the work.
// Generated once per member when the member joins the pack (the decisions module's worker job), never inside a page
// request. Versioned here so every change runs the eval set (evals/decisions.summariseMember/). The recommendation is
// advice for a person: it never moves a stage, and it can only be to advance or to hold while a gap is closed, never to
// reject (AGENTS.md 1.5, 1.6).

/** Bump with any change to the system prompt, the prompt or the schema; it is stored with every summary. */
// @2 (AIV-P2-011 review): a strength states what its excerpt states, in its words; @1 asked what the candidate "built,
// ran or measured", and its live answer for Arjun Menon called a design and runbook a service he built and ran.
export const SUMMARISE_MEMBER_VERSION = 'decisions.summariseMember@2';

/** Advance to the next round, or hold while the gap the focus names is closed. Never "reject": thin evidence is a gap. */
export const RECOMMENDATIONS = ['advance', 'hold'] as const;

export const MAX_STATEMENT_WORDS = 30;

const SUMMARISE_MEMBER_SYSTEM = [
  "You prepare one candidate's card in a decision pack for a hiring owner. The first source is the facts of the",
  "candidate's assessment, one line per competency, and a line saying how much of the weight the work meets the need",
  'on. The other sources are excerpts of the evidence: repositories, documents, references, the CV and Round 1',
  'interview notes. Write, each statement citing the sources it rests on with an exact quote:',
  'strengths: at most two statements, each about one excerpt of inspected work (a source after the first, never the',
  'CV): what that excerpt states, in its words, citing the excerpt; it may also name the competency the facts say the',
  'work backs and cite that line. A strength that cites no excerpt is rejected. It states nothing the excerpt does not:',
  'no other activity, role, scale or result, no adjective or adverb of your own about the work or its quality, and',
  'nothing about the person;',
  'risks: at most two statements on the competencies still resting on claims, short of the need or with no evidence',
  'yet, each citing the facts line or the excerpt it rests on; a claim with nothing to inspect is called a claim;',
  'round1: one statement on what the Round 1 interview notes say the candidate showed, citing those notes, or null',
  'when there are no interview notes;',
  'recommendation: action "advance" when the facts say the work meets the need on at least half of the weight,',
  'otherwise "hold"; focus, a short phrase without a full stop naming the gap from the facts to look into at the next',
  'interview, or the evidence to request first, or null; cite the facts lines the recommendation rests on.',
  `Each statement is at most ${MAX_STATEMENT_WORDS} words and says only what the sources it cites state. Never call`,
  'anything verified, proven or confirmed: say "independently checked" only where the facts say so.',
  'Never write a number word. A figure (a count, a level, a share of the weight) may appear only copied exactly from a',
  'quote the same statement cites.',
  'Refer to the candidate as "the candidate", never by name, and never quote a placeholder ([CANDIDATE], [EMAIL_1]).',
  'Judge only the evidence of the work, never the person.',
  'Never advise rejecting, hiring or advancing anyone in a statement or the focus: the action is the only',
  'recommendation, and a person decides.',
].join(' ');

const words = (text: string) => text.trim().split(/\s+/).length;
// The rule's name goes on telemetry in place of zod's `custom` (citations.ts schemaRules): never output text.
const rule = (reason: string) => ({ params: { reason } });

// Rule 1.6: nothing is called verified, proven or confirmed ("unproven" is fine: it says the opposite).
const OVERSTATES = /\bverif|\bproven\b|\bconfirm/i;
// Rule 1.5: the action enum is the only advice; no statement or focus decides for the hiring owner.
const ADVICE = /\b(?:reject\w*|hire[sd]?|hiring|unsuitable|advanc\w*|move\s+forward|next\s+round)\b/i;
// A figure: a run of letters and digits that holds a digit ("412", "p95", "1,200"), as explainRanking reads one.
const FIGURE = /[\p{L}\p{N}]*\p{N}(?:[.,]\p{N}|[\p{L}\p{N}])*/gu;

const text = z
  .string()
  .min(1)
  .refine((t) => words(t) <= MAX_STATEMENT_WORDS, rule('too_long'))
  .refine((t) => !NUMBER_WORDS.test(t) && !ONE_COUNT.test(t), rule('number_word'))
  .refine((t) => !OVERSTATES.test(t), rule('overstates'))
  .refine((t) => !ADVICE.test(t), rule('advice'));

/** Every figure in `text` is one a citation of the same statement quotes, so no number is the model's own. */
// "Round 1" and "Round 2" name the interview rounds, not a figure of the candidate's.
export const figuresQuoted = (written: string, quotes: readonly string[]) => {
  const quoted = new Set(quotes.flatMap((q) => q.match(FIGURE) ?? []));
  return (written.replace(/\bRound \d\b/g, '').match(FIGURE) ?? []).every((figure) => quoted.has(figure));
};

const quotes = (s: { citations: { quote: string }[] }) => s.citations.map((c) => c.quote);
const statement = cited(z.object({ text })).refine((s) => figuresQuoted(s.text, quotes(s)), rule('figure_not_quoted'));

/** Azure strict mode needs every property present: nothing here is optional, `round1` and `focus` are nullable. */
export const summariseMemberSchema = z.object({
  strengths: z.array(statement).max(2),
  risks: z.array(statement).max(2),
  round1: statement.nullable(),
  recommendation: cited(z.object({ action: z.enum(RECOMMENDATIONS), focus: text.nullable() })).refine(
    (r) => figuresQuoted(r.focus ?? '', quotes(r)),
    rule('figure_not_quoted'),
  ),
});

const cites = (s: { citations: { sourceId: string }[] }, among: ReadonlySet<string>) =>
  s.citations.some((c) => among.has(c.sourceId));

/**
 * The schema for one request, over the labels the model sees: a strength cites inspected work (a source that is neither
 * the facts nor the CV), and the Round 1 finding is null without interview notes and cites them otherwise. A refine only:
 * the JSON schema the model is given, and so the prompt hash, do not change.
 */
const schemaFor = (sources: readonly Source[]) => {
  const labels = (keep: (s: Source, i: number) => boolean) =>
    new Set(sources.flatMap((s, i) => (keep(s, i) ? [sourceLabel(i)] : [])));
  const work = labels((s, i) => i > 0 && s.kind !== 'cv');
  const interview = labels((s) => s.kind === 'interview');
  return summariseMemberSchema.superRefine(({ strengths, round1 }, ctx) => {
    strengths.forEach((s, i) => {
      if (!cites(s, work))
        ctx.addIssue({
          code: 'custom',
          path: ['strengths', i],
          message: 'cites work',
          params: { reason: 'not_backed' },
        });
    });
    // With no notes given, any finding cites none of them.
    if (round1 && !cites(round1, interview))
      ctx.addIssue({ code: 'custom', path: ['round1'], message: 'cites the notes', params: { reason: 'not_round1' } });
  });
};

/**
 * The whole request but its workspace and identifiers, so the decisions module and the eval runner send the same thing:
 * the facts source first, then the excerpts (an interview note as kind `interview`).
 */
export const summariseMemberRequest = (sources: readonly Source[]) => ({
  task: 'decisions.summariseMember' as const,
  promptVersion: SUMMARISE_MEMBER_VERSION,
  system: SUMMARISE_MEMBER_SYSTEM,
  prompt: "Prepare the candidate's card from the facts source and the excerpts.",
  schema: schemaFor(sources),
  sources,
});
