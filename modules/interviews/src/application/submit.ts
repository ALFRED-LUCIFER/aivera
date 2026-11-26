// Submitting a scorecard (AIV-P2-006): in the caller's one transaction the interview is completed, the scorecard
// stored, each rated competency's note recorded as `interview_note` evidence, and the ratings the person previewed
// applied through the assessment's own audited command (AIV-P1-117), whose audit entries are the last statements.
import type { Tx } from '@credalent/db';
import type { WorkspaceContext } from '@credalent/workspaces';
import { z } from 'zod';
import { canMove, effectiveStatus, InterviewError, type Interview } from '../domain/interview.ts';
import { assessedRatings, rebuildDraft, toInterviewNoteEvidence, unexplained, unrated } from '../domain/scorecard.ts';
import { scorecardHolder, type Ports } from './interviews.ts';
import type { DecisionPorts, SummaryPorts } from './summary.ts';

export type SubmitPorts = Pick<Ports, 'storeFor' | 'authorize' | 'jobResource' | 'isSyntheticWorkspace' | 'now'> &
  Pick<SummaryPorts, 'rubric'> &
  Pick<DecisionPorts, 'latestAssessment'> & {
    /** The assessment's `applyScoreChange`: the snapshot it leaves the candidate with. */
    applyScoreChange(
      ctx: WorkspaceContext,
      input: Parameters<DecisionPorts['applyScoreChange']>[1],
    ): Promise<{ id: string }>;
    /** The evidence contract's `recordInterviewSummary`, for a scorecard's notes. */
    recordScorecardEvidence(
      ctx: WorkspaceContext,
      input: Parameters<DecisionPorts['recordSummaryEvidence']>[1] & { from: 'scorecard' },
    ): Promise<{ itemIds: string[] }>;
    /** The questions the scorecard page shows per competency: the assessment's stored suggested ones (AIV-P1-113). */
    suggestedQuestions(
      ctx: WorkspaceContext,
      candidateId: string,
      jobId: string,
    ): Promise<{ competencyId: string; questions: string[] }[]>;
    /** Writes `InterviewCompleted.v1` to the outbox in `tx`, so it commits only with the submit. */
    publishInterviewCompleted(tx: Tx, interview: Interview): Promise<void>;
  };

const submitInput = z.strictObject({ previewId: z.string().min(1).max(128).nullable() });
export type SubmitScorecardInput = z.input<typeof submitInput>;

/** `updated`: the assessment has a new snapshot; false when nothing was rated or no rating moved anything. */
export type SubmittedScorecard = { updated: boolean };

// The assessment refuses an apply with its own error; this module has no dependency on its package.
const refusedByAssessment = (error: unknown) => error instanceof Error && error.name === 'ScoreChangeError';

const STRENGTHENS = new Set(['clearly_shown', 'strongly_shown']);

export function submitUseCases(ports: SubmitPorts) {
  const { storeFor, now } = ports;
  return {
    async submitScorecard(
      ctx: WorkspaceContext,
      interviewId: string,
      raw: SubmitScorecardInput,
    ): Promise<SubmittedScorecard> {
      const { previewId } = submitInput.parse(raw);
      const interview = await scorecardHolder(ports, ctx, interviewId);
      if (interview.status === 'completed') throw new InterviewError('scorecard_submitted');
      const status = effectiveStatus(interview, now());
      if (status === 'cancelled') throw new InterviewError('scorecard_closed');
      if (!canMove(status, 'completed')) throw new InterviewError('interview_not_held');
      const { candidateId, jobId } = interview;
      const store = storeFor(ctx.tx);
      // SAFETY: rebuilt on the questions the page shows, so a request cannot leave a competency unrated ("not
      // assessed") by marking questions nobody was shown; the ratings are the stored draft's, never the request's.
      const shown = await ports.suggestedQuestions(ctx, candidateId, jobId);
      const draft = rebuildDraft(
        interview.competencyIds.map((id) => ({
          competencyId: id,
          questions: shown.find((s) => s.competencyId === id)?.questions ?? [],
        })),
        await store.findDraft(ctx.workspaceId, interviewId),
      );
      if (unrated(draft).length > 0 || unexplained(draft).length > 0) throw new InterviewError('scorecard_incomplete');
      // A competency not assessed in this round carries no rating, so it changes nothing and stays a gap (AGENTS.md 1.6).
      const rated = assessedRatings(draft);
      const latest = rated.length > 0 ? await ports.latestAssessment(ctx, candidateId, jobId) : null;
      if (rated.length > 0 && !latest) throw new InterviewError('not_assessed');
      if (rated.length > 0 && !previewId) throw new InterviewError('preview_changed');
      // Completed once: a second submit, or a double click waiting on this row, finds it no longer in `status`.
      if (!(await store.moveStatus(ctx.workspaceId, interviewId, interview.status, 'completed')))
        throw new InterviewError('scorecard_submitted');
      // The submitted scorecard, recommendation included: a recommendation for the hiring owner, it changes no stage.
      await store.saveDraft({
        ...draft,
        workspaceId: ctx.workspaceId,
        interviewId,
        updatedBy: ctx.userId,
        updatedAt: now(),
      });
      await ports.publishInterviewCompleted(ctx.tx, interview);
      if (!latest || !previewId) return { updated: false };

      const rubric = await ports.rubric(ctx.tx, ctx.workspaceId, jobId);
      // Each note as the interviewer's word, cited by the change it backs (AGENTS.md 1.6): Medium at the level the job
      // needs for Clearly or Strongly shown, as the assessment's change adds; otherwise Claim only, at no level.
      // shortcut: the live task's answer, time taken and prompt trail are not in the draft yet, so none is recorded;
      // AIV-P2-055 and AIV-P2-056 add them to the draft and to this evidence.
      const notes = toInterviewNoteEvidence({ interviewId, authorMemberId: ctx.userId, draft });
      const { itemIds } = await ports.recordScorecardEvidence(ctx, {
        candidateId,
        jobId,
        writtenAt: now(),
        from: 'scorecard',
        items: notes.map(({ competencyId, rating, note }) => {
          const level = rubric?.competencies.find((c) => c.id === competencyId)?.levelNeeded;
          if (rubric?.id !== interview.rubricVersionId || level === undefined)
            throw new InterviewError('competency_not_in_rubric');
          const medium = STRENGTHENS.has(rating);
          return { competencyId, excerpt: note, strength: medium ? 'medium' : 'claim', level: medium ? level : 0 };
        }),
        synthetic: await ports.isSyntheticWorkspace(ctx),
      });
      try {
        // Last: the snapshot, the changes, then one audit entry per change (AGENTS.md 3.6).
        const after = await ports.applyScoreChange(ctx, {
          assessmentId: latest.id,
          interviewId,
          changes: rated.map(({ competencyId, rating }) => ({ competencyId, rating })),
          previewId,
          reason: rated[0]?.note ?? '',
          reasons: Object.fromEntries(rated.map((r) => [r.competencyId, r.note])),
          idempotencyKey: interviewId,
          writeUpItemIds: itemIds,
        });
        return { updated: after.id !== latest.id };
      } catch (error) {
        if (refusedByAssessment(error)) throw new InterviewError('preview_changed');
        throw error;
      }
    },
  };
}
