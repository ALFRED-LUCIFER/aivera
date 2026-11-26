// An interview's scorecard (AIV-P2-004): what the interviewer saw for each competency the interview tests. Ratings exist
// only per rubric competency: no overall score, no summary of the person, no communication, English, confidence,
// attitude or soft-skill score, from a model or as a field (AGENTS.md 1.6). A test snapshots the schema to keep it so.
import { z } from 'zod';

/** Must list exactly `RATINGS` of `@credalent/assessment` (AIV-P1-117), which applies them; apps/web tests they match. */
export const RATINGS = ['not_shown', 'partly_shown', 'clearly_shown', 'strongly_shown'] as const;
export type Rating = (typeof RATINGS)[number];

/** Why a question tested nothing. "Not shown" is a rating given after asking, never one of these. */
export const MARKS = ['not_asked', 'not_answered'] as const;
export type Mark = (typeof MARKS)[number];

/** A recommendation for the hiring owner, who decides in the decision pack: it changes no stage (AGENTS.md 1.5). */
export const RECOMMENDATIONS = ['shortlist', 'more_evidence', 'not_recommended'] as const;
export type Recommendation = (typeof RECOMMENDATIONS)[number];

/**
 * A draft as the browser sends it and the database keeps it. Strict: a field this schema does not name is refused.
 * `questions` are the questions shown for the competency when it was saved, each with its mark, so a draft says which
 * questions were not asked even after new ones are suggested. A guide's live task (AIV-P2-003) is one more entry.
 */
export const scorecardDraftSchema = z.strictObject({
  competencies: z
    .array(
      z.strictObject({
        competencyId: z.uuid(),
        rating: z.enum(RATINGS).nullable(),
        /** "What you saw or heard". */
        note: z.string().max(4000),
        questions: z.array(z.strictObject({ text: z.string().max(2000), mark: z.enum(MARKS).nullable() })).max(20),
      }),
    )
    .max(50),
  recommendation: z.enum(RECOMMENDATIONS).nullable(),
});
export type ScorecardDraft = z.infer<typeof scorecardDraftSchema>;

/** A scorecard's ratings to preview (AIV-P2-005): one per competency. */
export const scorecardRatingsSchema = z
  .array(z.strictObject({ competencyId: z.uuid(), rating: z.enum(RATINGS) }))
  .min(1)
  .max(50)
  .refine((rs) => new Set(rs.map((r) => r.competencyId)).size === rs.length, 'One rating per competency');
export type ScorecardRatings = z.infer<typeof scorecardRatingsSchema>;
export type DraftCompetency = ScorecardDraft['competencies'][number];

/** "Not assessed in this round · stays a gap": every question was not asked or not answered, so nothing was tested. */
export const notAssessed = ({ questions }: Pick<DraftCompetency, 'questions'>) =>
  questions.length > 0 && questions.every((q) => q.mark !== null);

/**
 * The ratings the scorecard carries: one per competency the interviewer tested and rated. A competency that was not
 * assessed carries none, whatever rating it held before its questions were marked, so it is never scored down and
 * stays a gap for the next round (AGENTS.md 1.6). The score preview (AIV-P2-005) and the submit (AIV-P2-006) read
 * ratings only from here.
 */
export const assessedRatings = (draft: ScorecardDraft) =>
  draft.competencies.flatMap((c) =>
    c.rating && !notAssessed(c) ? [{ competencyId: c.competencyId, rating: c.rating, note: c.note.trim() }] : [],
  );

/** Competencies that block a submit: neither rated nor marked as not tested. */
export const unrated = (draft: ScorecardDraft) =>
  draft.competencies.filter((c) => !c.rating && !notAssessed(c)).map((c) => c.competencyId);

/**
 * Rated competencies with nothing written under "What you saw or heard": the note is the reason logged with the change
 * and the words its evidence cites (AGENTS.md 1.6, 3.6), so they block a submit too.
 */
export const unexplained = (draft: ScorecardDraft) =>
  assessedRatings(draft)
    .filter((c) => !c.note)
    .map((c) => c.competencyId);

/**
 * The draft for the competencies shown, each with the questions shown for it now (`['']` with none suggested: the
 * interviewer's own questions), its stored rating and note, and the mark stored for the same words. A competency not in
 * `stored` starts unrated. The form starts from it, and the submit (AIV-P2-006) rebuilds the stored draft with it, so a
 * competency is "not assessed" only by the questions the page showed, never by questions a request made up.
 */
export function rebuildDraft(
  competencies: readonly { competencyId: string; questions: readonly string[] }[],
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
        questions: (questions.length > 0 ? questions : ['']).map((text) => ({ text, mark: marks.get(text) ?? null })),
      };
    }),
    recommendation: stored?.recommendation ?? null,
  };
}

export type InterviewNoteEvidence = {
  kind: 'interview_note';
  interviewId: string;
  competencyId: string;
  /** The interviewer: a workspace member is named by their user id. */
  authorMemberId: string;
  rating: Rating;
  note: string;
};

/**
 * Each rated competency's note as an `interview_note` evidence payload for the evidence contract's `recordEvidence`;
 * the scorecard submit (AIV-P2-006) writes them in its transaction. A competency not assessed in this round gives none.
 */
export const toInterviewNoteEvidence = (scorecard: {
  interviewId: string;
  authorMemberId: string;
  draft: ScorecardDraft;
}): InterviewNoteEvidence[] =>
  assessedRatings(scorecard.draft).map((rated) => ({
    kind: 'interview_note',
    interviewId: scorecard.interviewId,
    authorMemberId: scorecard.authorMemberId,
    ...rated,
  }));
