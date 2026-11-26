import { z } from 'zod';
import { cited, sourceLabel, type Source } from '../citations.ts';

// "Suggest interview questions" (AIV-P1-113), ADR-006 point 2: for each gap in a candidate's evidence, two or three
// open questions a person may ask, each citing the evidence it tests, with what a strong and a weak answer show.
// Versioned here so every change runs the eval set (evals/assessment.suggestQuestions/). The questions are guidance for
// a person: they change no score, stage or rank (AGENTS.md 1.5). The interview guide (AIV-P2-003) reuses this prompt.

// AIV-P1-137: @3 asked about a figure without naming it and wrote notes such as "Gives vague or generic answers", which
// the eval now fails in code; @4 has the question write the figure and the notes name what an answer must show.
/** Bump with any change to the system prompt, the prompt or the schema; it is stored with every question set. */
export const SUGGEST_QUESTIONS_VERSION = 'assessment.suggestQuestions@4';

export const MAX_QUESTION_WORDS = 30;
export const MAX_NOTE_WORDS = 25;

// The system prompt is exported so eval.test.ts checks it never repeats or overrides the shared untrusted-content rule.
export const SUGGEST_QUESTIONS_SYSTEM = [
  'You help a recruiter prepare an interview. The prompt lists the job, its domain pack and the gaps in one',
  "candidate's evidence: competencies whose evidence is below the level the job needs, or rests on a claim nobody has",
  'inspected. For each gap give its competencyId, copied exactly from the list, and two or three questions the',
  'interviewer can ask to test what is unproven.',
  `Each question: text, an open question of at most ${MAX_QUESTION_WORDS} words that starts with How, What, Which, Why, "Walk me through",`,
  '"Describe" or "Tell me about", never one a yes or a no answers, specific to this job, its domain pack and the cited',
  'evidence, never a generic interview question. When a line you cite states figures (a percentage, a count, a',
  'rate), the first question on it writes each of them exactly as the line does: a line that cut errors "from 9% to',
  '4%" gives "How were the 9% and the 4% measured, on which data, and what did you do yourself?".',
  `strongAnswer, at most ${MAX_NOTE_WORDS} words on what a strong answer shows about the cited evidence; weakAnswer, at most ${MAX_NOTE_WORDS} words`,
  'naming what a weak answer leaves out about it ("Cannot say which data the 9% was measured on"). A note names only',
  "that thing (how a figure was measured, the data or questions behind it, the system, the candidate's own part) and",
  "never describes the answer's manner: no note calls an answer vague, general, generic or lacking detail.",
  'citations, quoting the words of a source listed under that gap\'s "Cite only" that the question tests.',
  'A source listed under "Notes to aim the questions" says what the evidence does not show and what would change it:',
  'use it to aim a question, but never cite it, not even beside another citation; quote the evidence the question',
  'tests instead.',
  'A quote never contains a placeholder ([CANDIDATE], [EMAIL_1], [PHONE_1]). Address the candidate as "you" and never',
  'by name.',
  'Give questions only for the listed gaps, and none for any other competency.',
  'Ask only about the work and the evidence. Never ask about age, nationality, religion, family, health, gender or any',
  'other personal trait, and never suggest rejecting, advancing or contacting anyone: a person decides.',
].join(' ');

const words = (text: string) => text.trim().split(/\s+/).length;

// A question that opens with an auxiliary verb ("Did you build the evaluation set?") is answered with yes or no.
const CLOSED =
  /^\W*(?:did|do|does|is|are|was|were|have|has|had|can|could|would|will|should|shall|may|might|am)(?:n't)?\b/i;

// shortcut: phrases that ask about the person, so a trait asked in other words passes; the prompt, the eval's
// forbidden words and the recruiter who reads the question are the backstop. Widen it if an eval or a pilot shows one.
const PROTECTED_TRAIT =
  /\b(?:your|their|his|her) (?:own )?(?:age|nationality|citizenship|religion|faith|family|health|gender|marital status|children|spouse|wife|husband|disability|ethnicity)\b|\bhow old\b|\bwhere (?:are|were) you (?:from|born)\b/i;

/** Whether the text asks about a protected trait (AGENTS.md 1.5, 1.8): the schema rejects it and the eval fails it. */
export const asksProtectedTrait = (text: string) => PROTECTED_TRAIT.test(text);

// The rule's name goes on telemetry in place of zod's `custom` (citations.ts schemaRules): never output text.
const rule = (reason: string) => ({ params: { reason } });
// The same, as a superRefine issue at `path`.
const issue = (path: (string | number)[], reason: string) =>
  ({ code: 'custom', path, message: reason, params: { reason } }) as const;

const note = z
  .string()
  .min(1)
  .refine((text) => words(text) <= MAX_NOTE_WORDS, rule('note_too_long'));

const question = cited(
  z.object({
    text: z
      .string()
      .min(1)
      .refine((text) => words(text) <= MAX_QUESTION_WORDS, rule('question_too_long'))
      .refine((text) => !CLOSED.test(text), rule('question_not_open'))
      .refine((text) => !asksProtectedTrait(text), rule('protected_trait')),
    strongAnswer: note,
    weakAnswer: note,
  }),
);

/**
 * The answer for the listed gaps, each with the source labels its questions may cite (its evidence) and its notes,
 * which are never cited. Rejected, so the client asks once more, rather than trimmed: questions for a competency that
 * is not listed (`competency_not_gap`), a listed gap left out (`gap_missing`) or answered twice (`gap_repeated`), and a
 * citation of another gap's evidence or of notes (`citation_not_gap`) (AGENTS.md 1.6, 3.7). A label listed for no gap
 * is left to the citation check, which names it `unknown_citation`.
 * Azure strict mode needs every property present: nothing here is optional (client.ts generateStructured).
 */
export const suggestQuestionsSchema = (
  gaps: readonly { id: string; citable: readonly string[]; notes?: readonly string[] }[],
) => {
  const citable = new Map(gaps.map((g) => [g.id, new Set(g.citable)]));
  const listed = new Set(gaps.flatMap((g) => [...g.citable, ...(g.notes ?? [])]));
  return z
    .object({
      gaps: z
        .array(
          z.object({
            competencyId: z.string().refine((id) => citable.has(id), rule('competency_not_gap')),
            questions: z.array(question).min(2).max(3),
          }),
        )
        .max(gaps.length),
    })
    .superRefine(({ gaps: answered }, ctx) => {
      const seen = new Set<string>();
      answered.forEach(({ competencyId, questions }, i) => {
        if (seen.has(competencyId)) ctx.addIssue(issue(['gaps', i, 'competencyId'], 'gap_repeated'));
        seen.add(competencyId);
        const own = citable.get(competencyId);
        if (!own) return;
        questions.forEach(({ citations }, j) =>
          citations.forEach(({ sourceId }, k) => {
            if (listed.has(sourceId) && !own.has(sourceId))
              ctx.addIssue(issue(['gaps', i, 'questions', j, 'citations', k, 'sourceId'], 'citation_not_gap'));
          }),
        );
      });
      if ([...citable.keys()].some((id) => !seen.has(id))) ctx.addIssue(issue(['gaps'], 'gap_missing'));
    });
};

/** One gap as the prompt lists it. `id` is a label of the caller's ("C1"), so no opaque id reaches the model. */
export type QuestionGapInput = {
  id: string;
  name: string;
  /** What the competency means for this job: the approved rubric's "evidence expected". */
  meaning: string;
  levelNeeded: number;
  provenLevel: number;
  claimedLevel: number;
  /**
   * The gap's own sources, by their `Source.id`, each with what the evidence is: "supporting, claim". A `notes` source
   * says what the evidence does not show: it may aim a question but is never cited.
   */
  sources: readonly { id: string; evidence: string; notes?: boolean | undefined }[];
};

/**
 * The whole request but its workspace and identifiers, so the assessment module and the eval runner send the same
 * thing. The job and the rubric are the workspace's own text; everything about the candidate goes in `sources`,
 * wrapped as untrusted and with the candidate's identifiers replaced (AIV-P1-070, ADR-006 point 7).
 */
export const suggestQuestionsRequest = (
  job: { title: string; domainPack: string | null },
  gaps: readonly QuestionGapInput[],
  sources: readonly Source[],
) => {
  const label = (id: string) => sourceLabel(sources.findIndex((s) => s.id === id));
  const list = (listed: QuestionGapInput['sources']) => listed.map((s) => `${label(s.id)} (${s.evidence})`).join(', ');
  // The notes are listed apart from what may be cited: listed beside the evidence, gpt-4.1-mini cited them live.
  const notesOf = (g: QuestionGapInput) => {
    const notes = g.sources.filter((s) => s.notes);
    return notes.length ? ` Notes to aim the questions, never cited: ${notes.map((s) => label(s.id)).join(', ')}.` : '';
  };
  return {
    task: 'assessment.suggestQuestions' as const,
    promptVersion: SUGGEST_QUESTIONS_VERSION,
    system: SUGGEST_QUESTIONS_SYSTEM,
    prompt: [
      'Suggest interview questions for the gaps below.',
      `Job: ${job.title}`,
      `Domain pack: ${job.domainPack ?? 'none'}`,
      'Gaps:',
      ...gaps.map(
        (g) =>
          `- ${g.id}: ${g.name}. Meaning: ${g.meaning} Level the job needs: ${g.levelNeeded} of 5; shown by inspected work: ${g.provenLevel}; claimed: ${g.claimedLevel}. Cite only: ${list(g.sources.filter((s) => !s.notes))}.${notesOf(g)}`,
      ),
    ].join('\n'),
    schema: suggestQuestionsSchema(
      gaps.map((g) => ({
        id: g.id,
        citable: g.sources.filter((s) => !s.notes).map((s) => label(s.id)),
        notes: g.sources.filter((s) => s.notes).map((s) => label(s.id)),
      })),
    ),
    sources,
  };
};
