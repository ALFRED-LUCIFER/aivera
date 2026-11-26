import type { Strength } from '@credalent/evidence';
import {
  rebuildDraft,
  scorecardDraftSchema,
  scorecardRatingsSchema,
  type Round,
  type ScorecardDraft,
  type ScorePreview,
} from '@credalent/interviews';
import { z } from 'zod';
import type { EvidenceCard } from '@/features/evidence-profile/domain/evidenceCards.ts';
import type { QuestionView } from '@/features/evidence-profile/domain/questions.ts';
import { STRENGTHS } from '@/features/rubric/domain/rubric.ts';

// The interview scorecard (AIV-P2-004) as the page hands it to the browser. Pure. The rules (what counts as not
// assessed, what blocks a submit, the draft's schema) are the interviews module's: `@credalent/interviews`.

/** What the browser sends to save a draft, checked again in the interviews module (AGENTS.md 3.7). */
export const saveDraftInput = z.strictObject({ interviewId: z.uuid(), draft: scorecardDraftSchema });

/** What the browser sends to preview its ratings (AIV-P2-005), checked again in the interviews module (AGENTS.md 3.7). */
export const previewInput = z.strictObject({
  interviewId: z.uuid(),
  ratings: scorecardRatingsSchema,
});
export type PreviewRatings = z.infer<typeof previewInput>['ratings'];

/**
 * What the browser sends to submit (AIV-P2-006): the preview the person saw (null with nothing rated), so the
 * assessment applies exactly that or refuses. The ratings are the stored draft's, read by the server.
 */
export const submitInput = z.strictObject({ interviewId: z.uuid(), previewId: z.string().min(1).max(128).nullable() });

/** How a submit ended, as the form says it. */
export type SubmitOutcome = 'updated' | 'unchanged' | 'already' | 'changed' | 'incomplete' | 'failed';

type CompetencyState = ScorePreview['changes'][number]['from'];

/** The assessment's preview of the ratings (`previewScorecardRatings`), as far as the panel shows it. */
export type EffectPreview = Pick<ScorePreview, 'backedScore' | 'previewId'> & {
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
  | { status: 'ready'; lines: EffectLine[]; backedScore: EffectPreview['backedScore']; previewId: string };

// Strong 4, Medium 3, Supporting 2, Claim only 1, no evidence 0.
const order = (strength: Strength | null) => (strength ? STRENGTHS.length - STRENGTHS.indexOf(strength) : 0);

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
  effect: EffectPreview,
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
  /** The job's ranking, which a submitted scorecard updates. */
  rankingHref: string;
  /** The scorecard was submitted: the interview is completed (AIV-P2-006). */
  submitted: boolean;
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
export const startingDraft = (
  competencies: readonly Pick<ScorecardCompetency, 'competencyId' | 'questions'>[],
  stored: ScorecardDraft | null,
): ScorecardDraft =>
  rebuildDraft(
    competencies.map(({ competencyId, questions }) => ({ competencyId, questions: questions.map((q) => q.text) })),
    stored,
  );
