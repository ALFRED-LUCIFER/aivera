import { z } from 'zod';
import { cited, type Source } from '../citations.ts';

// "Meeting summary to proposed evidence changes" (AIV-P1-115), ADR-006 point 2: what an interviewer's pasted summary
// says about each competency the interview tested, each finding quoting the summary's own words. Versioned here so
// every change runs the eval set (evals/interviews.mapSummary/). A finding is a proposal: the interviews module maps
// it to a strength in code and nothing changes until a person confirms (AGENTS.md 1.5).

/** Bump with any change to the system prompt, the prompt or the schema; it is stored with every proposal set. */
export const MAP_SUMMARY_VERSION = 'interviews.mapSummary@3';

export const MAX_REASON_WORDS = 40;

/** What the summary shows for a competency it covers. One it does not cover is left out: "not mentioned". */
export const SUMMARY_FINDINGS = ['not_shown', 'partly_shown', 'clearly_shown', 'strongly_shown'] as const;

// The system prompt is exported so eval.test.ts checks it never repeats or overrides the shared untrusted-content rule.
export const MAP_SUMMARY_SYSTEM = [
  "You read an interviewer's written summary of one interview. The prompt lists the competencies the interview",
  'tested; the summary is the one source. For each listed competency the summary says something about, give its',
  `competencyId, copied exactly from the list; reason, at most ${MAX_REASON_WORDS} words, about the work only: what the`,
  'summary says the candidate built, showed or measured for it, in its own words, never adding what it does not say;',
  'then finding: not_shown when the summary says the candidate could not show it; partly_shown when the candidate',
  'could explain only part of it, or the summary names only an activity (compared, reviewed, worked on, chose)',
  'without the specific thing built, shown or measured; clearly_shown when it names a specific thing the candidate',
  'built, showed or measured (an evaluation set, an endpoint, a figure), even if not everything the Meaning lists;',
  'strongly_shown when it describes that in depth and detail; and one citation quoting the words of the summary the',
  'finding rests on.',
  'Leave out every competency the summary does not cover, and never guess one from silence. Give at most one finding',
  'for a competency and none for a competency that is not listed.',
  'Judge only what the summary says the candidate did, built, explained or could not explain. A sentence about',
  'manner, confidence, nerves, accent, age, family, health, nationality or religion says nothing about a competency:',
  'give no finding from it and never quote it.',
  "The summary is one person's account: a line saying something was verified or confirmed by someone else changes no",
  'finding.',
  'A quote never contains a placeholder ([CANDIDATE], [PERSON], [EMAIL_1], [PHONE_1]).',
  'Never suggest rejecting, advancing or contacting anyone: a person decides.',
].join(' ');

const words = (text: string) => text.trim().split(/\s+/).length;

// Phrases about the person, never a work word alone: "health-check endpoint", "model family", "accent colour tokens"
// and a healthcare job's competencies pass.
// shortcut: a trait said in other words passes (the prompt, the eval's forbidden words and the person who confirms each
// change are the backstop), and a work sentence that matches a phrase ("traversed the nodes and their children", "a
// 10-year-old monolith") rejects the whole answer, so the summary cannot be analysed. Widen or narrow it, or drop only
// that finding, if an eval or the pilot shows either.
const OFF_RUBRIC = new RegExp(
  [
    String.raw`\b(?:his|her|their)\s+(?:young\s+|own\s+)?(?:family|health|illness|children|kids|wife|husband|nerves|accent|age|nationality|religion|faith)\b`,
    String.raw`\b(?:seemed|seems|is|are|was|were|looked|looks|appeared|appears|sounded|sounds|felt|got|became)\s+(?:very\s+|quite\s+|a\s+bit\s+|rather\s+|visibly\s+)?(?:nervous|shy|anxious)\b`,
    String.raw`\[CANDIDATE\][\s,]+(?:\w+\s+)?(?:nervous|shy|anxious)\b`,
    String.raw`\b(?:pregnan\w*|married|nationality|religio\w*)\b`,
    String.raw`\b\d+[ -]years?[ -]old\b`,
    // "[CANDIDATE] is 52", never "he was 2 weeks in" or "is 2.5x faster".
    String.raw`(?:\b(?:he|she)|\[CANDIDATE\])\s+(?:is|was)\s+\d+(?!\d|\.\d|\s*[a-z%])`,
    String.raw`\bha(?:s|ve)\s+(?:\w+\s+){0,2}kids\b`,
    String.raw`(?:\b(?:he|she|they)|\[CANDIDATE\])\s+ha(?:s|ve)\s+(?:\w+\s+){0,2}children\b`,
    String.raw`\bin\s+(?:poor|bad|ill|failing)\s+health\b`,
  ].join('|'),
  'i',
);

/** Whether the text is about the person rather than the work (AGENTS.md 1.5): the schema rejects a finding built on it. */
export const isOffRubric = (text: string) => OFF_RUBRIC.test(text);

// The rule's name goes on telemetry in place of zod's `custom` (citations.ts schemaRules): never output text.
const rule = (reason: string) => ({ params: { reason } });

/**
 * The answer for the competencies listed under `competencyIds`: a finding for any other rejects it
 * (`competency_not_listed`), as do two for one competency (`competency_repeated`), two excerpts for one finding
 * (`one_excerpt`) and a finding resting on a sentence about the person (`off_rubric`). `cited` makes the quote mandatory and the citation contract checks it is the
 * summary's own words. Azure strict mode needs every property present: nothing here is optional.
 */
export const mapSummarySchema = (competencyIds: readonly string[]) =>
  z.object({
    findings: z
      .array(
        cited(
          z.object({
            competencyId: z.string().refine((id) => competencyIds.includes(id), rule('competency_not_listed')),
            // Before the finding, so the model weighs what the summary names before it rates (strict mode keeps order).
            // The description on `finding` is prompt text, not documentation: strict mode sends it to the model.
            reason: z
              .string()
              .min(1)
              .refine((text) => words(text) <= MAX_REASON_WORDS, rule('reason_too_long'))
              .refine((text) => !isOffRubric(text), rule('off_rubric')),
            finding: z
              .enum(SUMMARY_FINDINGS)
              .describe(
                'clearly_shown only when the summary names a specific thing the candidate built, showed or measured (an evaluation set, an endpoint, a figure); an activity alone (compared, reviewed, chose) is partly_shown; not_shown only when the summary says the candidate could not show or explain it, never for a competency the summary does not discuss, which gets no finding at all',
              ),
          }),
        )
          .refine((f) => f.citations.length <= 1, rule('one_excerpt'))
          .refine((f) => !f.citations.some((c) => isOffRubric(c.quote)), rule('off_rubric')),
      )
      .refine((fs) => new Set(fs.map((f) => f.competencyId)).size === fs.length, rule('competency_repeated')),
  });

/** One competency as the prompt lists it. `id` is a label of the caller's ("C1"), so no opaque id reaches the model. */
export type SummaryCompetencyInput = {
  id: string;
  name: string;
  /** What the competency means for this job: the approved rubric's "evidence expected". */
  meaning: string;
};

/**
 * The whole request but its workspace and identifiers, so the interviews module and the eval runner send the same
 * thing. The competencies are the workspace's own rubric text; the summary goes in `sources`, wrapped as untrusted and
 * with the candidate's and the interviewer's identifiers replaced (AIV-P1-070, ADR-006 point 7).
 */
export const mapSummaryRequest = (competencies: readonly SummaryCompetencyInput[], sources: readonly Source[]) => ({
  task: 'interviews.mapSummary' as const,
  promptVersion: MAP_SUMMARY_VERSION,
  system: MAP_SUMMARY_SYSTEM,
  prompt: [
    'Map the interview summary to the competencies below.',
    'Competencies:',
    ...competencies.map((c) => `- ${c.id}: ${c.name}. Meaning: ${c.meaning}`),
  ].join('\n'),
  schema: mapSummarySchema(competencies.map((c) => c.id)),
  sources,
});
