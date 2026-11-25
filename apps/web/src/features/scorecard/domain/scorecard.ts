import type { CompetencyState } from '@credalent/assessment';
import type { Strength } from '@credalent/evidence';
import { RATINGS, scorecardDraftSchema, type Round, type ScorecardDraft } from '@credalent/interviews';
import { z } from 'zod';
import type { EvidenceCard } from '@/features/evidence-profile/domain/evidenceCards.ts';
import type { QuestionView } from '@/features/evidence-profile/domain/questions.ts';

// The interview scorecard (AIV-P2-004) as the page hands it to the browser. Pure. The rules (what counts as not
// assessed, what blocks a submit, the draft's schema) are the interviews module's: `@credalent/interviews`.

/** What the browser sends to save a draft, checked again in the interviews module (AGENTS.md 3.7). */
export const saveDraftInput = z.strictObject({ interviewId: z.uuid(), draft: scorecardDraftSchema });

/** What the browser sends to preview its ratings (AIV-P2-005), checked again by the assessment (AGENTS.md 3.7). */
export const previewInput = z.strictObject({
  interviewId: z.uuid(),
  ratings: z
    .array(z.strictObject({ competencyId: z.uuid(), rating: z.enum(RATINGS) }))
    .min(1)
    .max(50),
});
export type PreviewRatings = z.infer<typeof previewInput>['ratings'];

/** The assessment's preview of the ratings (`previewScoreChange`), as far as the panel shows it. */
export type ScoreEffect = {
  backedScore: { from: number; to: number };
  changes: { competencyId: string; from: CompetencyState; to: CompetencyState }[];
};

/** One rated competency in "Effect on the assessment". */
export type EffectLine = {
  competencyId: string;
  name: string;
  direction: 'weakened' | 'unchanged' | 'strengthened';
  from: Strength | null;
  to: Strength | null;
};

/** The panel's states: nothing rated yet, the first preview on its way, not previewable now, or the preview. */
export type EffectState =
  | { status: 'empty' | 'pending' | 'unavailable' }
  | { status: 'ready'; lines: EffectLine[]; backedScore: ScoreEffect['backedScore'] };

// Weakest first; no evidence (null) below them all. Not the evidence module's STRENGTHS: its entry is server-only.
const WEAKEST_FIRST: readonly (Strength | null)[] = [null, 'claim', 'supporting', 'medium', 'strong'];
const order = (strength: Strength | null) => WEAKEST_FIRST.indexOf(strength);

/** Weakened or strengthened by the strength, then by the proven level; nothing moved is "No change", whatever the rating. */
const directionOf = (from: CompetencyState, to: CompetencyState): EffectLine['direction'] => {
  const moved = order(to.strength) - order(from.strength) || to.provenLevel - from.provenLevel;
  return moved < 0 ? 'weakened' : moved > 0 ? 'strengthened' : 'unchanged';
};

/**
 * One line per previewed rating, in the scorecard's order. A Partly shown that moves nothing is not in the preview
 * (AIV-P1-117): it stays at the strength the latest assessment cites for it.
 */
export const effectLines = (
  rated: PreviewRatings,
  effect: ScoreEffect,
  competencies: readonly (Pick<ScorecardCompetency, 'competencyId' | 'name'> & {
    evidence: { lead: { strength: Strength } | null } | null;
  })[],
): EffectLine[] =>
  rated.flatMap(({ competencyId }) => {
    const competency = competencies.find((c) => c.competencyId === competencyId);
    if (!competency) return [];
    const change = effect.changes.find((c) => c.competencyId === competencyId);
    const stays = competency.evidence?.lead?.strength ?? null;
    return {
      competencyId,
      name: competency.name,
      direction: change ? directionOf(change.from, change.to) : 'unchanged',
      from: change ? change.from.strength : stays,
      to: change ? change.to.strength : stays,
    };
  });

export type ScorecardCompetency = {
  competencyId: string;
  name: string;
  weightPercent: number;
  /** What the latest assessment cites for the competency; null when there is no result on the interview's rubric version. */
  evidence: EvidenceCard | null;
  /** The stored suggested questions for the competency (AIV-P1-113); empty when none were suggested. */
  questions: QuestionView[];
};

export type ScorecardData = {
  interviewId: string;
  /** Null: the person has no name yet. */
  candidate: string | null;
  job: string;
  round: Round;
  /** ISO time; null while the interview has no time. */
  scheduledAt: string | null;
  today: boolean;
  /** Their title or name; null for the signed-in member, shown as "you". */
  interviewer: string | null;
  /** The candidate's evidence profile for the job, where questions are suggested. */
  profileHref: string;
  /** The latest assessment on the interview's rubric version: basis "observed". Null: not yet available. */
  assessed: { at: string; backedScore: number } | null;
  competencies: ScorecardCompetency[];
  /** False for a member who is not the interviewer or an admin, and once the interview is completed or cancelled. */
  canEdit: boolean;
  draft: ScorecardDraft;
};

/**
 * The draft the form starts from: one entry per competency shown, with the stored rating and note, and each question
 * shown now with the mark stored for the same words. A competency with no suggested question gets one unnamed entry,
 * the interviewer's own questions, so "Not asked" can still be said of it and it is never rated by default.
 */
export function startingDraft(
  competencies: readonly Pick<ScorecardCompetency, 'competencyId' | 'questions'>[],
  stored: ScorecardDraft | null,
): ScorecardDraft {
  return {
    competencies: competencies.map(({ competencyId, questions }) => {
      const saved = stored?.competencies.find((c) => c.competencyId === competencyId);
      const marks = new Map(saved?.questions.map((q) => [q.text, q.mark]));
      return {
        competencyId,
        rating: saved?.rating ?? null,
        note: saved?.note ?? '',
        questions: (questions.length > 0 ? questions.map((q) => q.text) : ['']).map((text) => ({
          text,
          mark: marks.get(text) ?? null,
        })),
      };
    }),
    recommendation: stored?.recommendation ?? null,
  };
}
