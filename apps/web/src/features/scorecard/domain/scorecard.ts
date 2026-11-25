import { scorecardDraftSchema, type Round, type ScorecardDraft } from '@credalent/interviews';
import { z } from 'zod';
import type { EvidenceCard } from '@/features/evidence-profile/domain/evidenceCards.ts';
import type { QuestionView } from '@/features/evidence-profile/domain/questions.ts';

// The interview scorecard (AIV-P2-004) as the page hands it to the browser. Pure. The rules (what counts as not
// assessed, what blocks a submit, the draft's schema) are the interviews module's: `@credalent/interviews`.

/** What the browser sends to save a draft, checked again in the interviews module (AGENTS.md 3.7). */
export const saveDraftInput = z.strictObject({ interviewId: z.uuid(), draft: scorecardDraftSchema });

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
