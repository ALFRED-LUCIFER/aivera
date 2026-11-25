// Preview and apply an interview-based score change (AIV-P1-117). Both run `prepare`, so they compute the same result;
// only `applyScoreChange` writes, and only when a person sent the preview back (AGENTS.md 1.5).
import { createHash } from 'node:crypto';
import { ForbiddenError, type WorkspaceContext } from '@credalent/workspaces';
import { z } from 'zod';
import type { RubricInput } from '../domain/assess.ts';
import { previewRatings, RATINGS, type CompetencyChange } from '../domain/scoreChange.ts';
import { canonical, pickAssessment, sameResult, toLinks, type Ports, type StoredAssessment } from './assessment.ts';
import type { WorkerPorts } from './worker.ts';

const MESSAGES = {
  stale: 'The assessment changed since this preview. Preview the change again.',
  competency_not_in_rubric: "This competency is not in the assessment's rubric version",
  source_not_found: 'Interview not found',
  interview_not_held: 'This interview has not been held',
  competency_not_in_interview: 'This competency is not one the interview investigates',
  not_yet_scored: 'New evidence is still being scored. Try again shortly.',
  idempotency_conflict: 'This idempotency key was used for a different change',
} as const;

export type ScoreChangeErrorCode = keyof typeof MESSAGES;

/** A refused score change: nothing was stored. The message never repeats the refused value (AGENTS.md 1.2). */
export class ScoreChangeError extends Error {
  readonly code: ScoreChangeErrorCode;
  constructor(code: ScoreChangeErrorCode) {
    super(MESSAGES[code]);
    this.name = 'ScoreChangeError';
    this.code = code;
  }
}

const changeInput = z.strictObject({
  /** The snapshot the change starts from: the candidate's latest for the job. */
  assessmentId: z.uuid(),
  /** The interview the ratings come from: the source every change cites. */
  interviewId: z.uuid(),
  changes: z
    .array(z.strictObject({ competencyId: z.uuid(), rating: z.enum(RATINGS) }))
    .min(1)
    .max(50)
    .refine((cs) => new Set(cs.map((c) => c.competencyId)).size === cs.length, 'One rating per competency'),
});
const applyInput = changeInput.extend({
  reason: z.string().trim().min(1).max(1000),
  previewId: z.string().min(1),
  idempotencyKey: z.uuid(),
});
export type ScoreChangeInput = z.input<typeof changeInput>;
export type ApplyScoreChangeInput = z.input<typeof applyInput>;

/**
 * What the ratings would do. Interview-sourced evidence is the interviewer's own word (`label`): never "verified",
 * never a second independent source. Every rating is listed, a Partly shown that changes nothing aside; one that moves
 * neither strength nor proven level now says why in `noChange`, and is still stored when applied.
 */
export type ScoreChangePreview = {
  /** Send it back to `applyScoreChange`: it names exactly this result. */
  previewId: string;
  assessmentId: string;
  label: 'interviewer_word';
  backedScore: { from: number; to: number };
  upperBound: { from: number; to: number };
  changes: Omit<CompetencyChange, 'change'>[];
};

/** A stored interview change (`assessment.interview_change`): what `recordAssessment` re-applies on every later run. */
export type InterviewChangeRow = CompetencyChange['change'] & {
  id: string;
  workspaceId: string;
  candidateId: string;
  jobId: string;
  /** The snapshot stored with the change. */
  resultId: string;
  idempotencyKey: string;
  previewId: string;
  reason: string;
  appliedBy: string;
  appliedAt: Date;
};

export type ScoreChangePorts = Pick<
  Ports,
  'storeFor' | 'authorize' | 'candidateJob' | 'auditScoreChange' | 'newId' | 'now'
> &
  Pick<WorkerPorts, 'evidenceForJob'> & {
    /**
     * The interview as the context may see it, or null (the interviews contract's `getInterview`: an interviewer sees
     * only their own): its candidate and job, the competencies it investigates and the status to show now.
     */
    interviewOf(
      ctx: WorkspaceContext,
      interviewId: string,
    ): Promise<{ candidateId: string; jobId: string; competencyIds: readonly string[]; status: string } | null>;
  };

// shortcut: `to_schedule` counts as held, because the pilot records results without scheduling (owner decision, 24 Nov
// 2026); only a future `scheduled` time and `cancelled` are refused. #118 narrows it when the scorecard starts interviews.
const HELD: readonly string[] = ['to_schedule', 'in_progress', 'scorecard_due', 'completed'];

export function scoreChangeUseCases(ports: ScoreChangePorts) {
  const { storeFor, authorize, candidateJob, evidenceForJob, interviewOf, auditScoreChange, newId, now } = ports;

  /** The snapshot, authorised against its stored job; refused alike when it is another workspace's or does not exist. */
  const authorised = async (ctx: WorkspaceContext, action: 'candidate.view' | 'scorecard.submit', id: string) => {
    const snapshot = await storeFor(ctx.tx).byId(ctx.workspaceId, id);
    if (!snapshot) throw new ForbiddenError();
    await authorize(ctx, action, (await candidateJob(ctx, snapshot.candidateId, snapshot.jobId)) ?? undefined);
    return snapshot;
  };

  const prepare = async (ctx: WorkspaceContext, snapshot: StoredAssessment, input: z.output<typeof changeInput>) => {
    const { candidateId, jobId } = snapshot;
    const interview = await interviewOf(ctx, input.interviewId);
    if (interview?.candidateId !== candidateId || interview.jobId !== jobId)
      throw new ScoreChangeError('source_not_found');
    if (!HELD.includes(interview.status)) throw new ScoreChangeError('interview_not_held');
    if (input.changes.some((c) => !interview.competencyIds.includes(c.competencyId)))
      throw new ScoreChangeError('competency_not_in_interview');
    const store = storeFor(ctx.tx);
    if ((await store.latest(ctx.workspaceId, candidateId, jobId))?.id !== snapshot.id)
      throw new ScoreChangeError('stale');
    // The snapshot carries its rubric version's weights and needs, so the change is scored on the version it shows.
    const rubric: RubricInput = {
      versionId: snapshot.rubricVersionId,
      competencies: snapshot.competencies.map((c) => ({
        id: c.competencyId,
        weightPercent: c.weightPercent,
        levelNeeded: c.levelNeeded,
        type: c.mandatory ? 'mandatory' : 'desirable',
      })),
    };
    if (input.changes.some((c) => !rubric.competencies.some((r) => r.id === c.competencyId)))
      throw new ScoreChangeError('competency_not_in_rubric');
    const links = toLinks(candidateId, jobId, await evidenceForJob(ctx.tx, ctx.workspaceId, candidateId, jobId));
    const stored = await store.interviewChanges(ctx.workspaceId, candidateId, jobId);
    const result = previewRatings(rubric, links, stored, input.changes, input.interviewId);
    // Evidence the worker has not scored yet would ride along unaudited: refused until its snapshot is stored.
    if (!sameResult(result.before, pickAssessment(snapshot))) throw new ScoreChangeError('not_yet_scored');
    const previewId = createHash('sha256')
      .update(canonical([snapshot.id, input.interviewId, input.changes, result.after, result.changes]))
      .digest('hex');
    return { ...result, previewId };
  };

  return {
    async previewScoreChange(ctx: WorkspaceContext, raw: ScoreChangeInput): Promise<ScoreChangePreview> {
      const input = changeInput.parse(raw);
      const snapshot = await authorised(ctx, 'candidate.view', input.assessmentId);
      const { before, after, changes, previewId } = await prepare(ctx, snapshot, input);
      return {
        previewId,
        assessmentId: snapshot.id,
        label: 'interviewer_word',
        backedScore: { from: before.backedScore, to: after.backedScore },
        upperBound: { from: before.upperBound, to: after.upperBound },
        changes: changes.map(({ change: _stored, ...shown }) => shown),
      };
    },

    async applyScoreChange(ctx: WorkspaceContext, raw: ApplyScoreChangeInput): Promise<StoredAssessment> {
      const input = applyInput.parse(raw);
      const snapshot = await authorised(ctx, 'scorecard.submit', input.assessmentId);
      const store = storeFor(ctx.tx);
      await store.lock(ctx.workspaceId, snapshot.candidateId, snapshot.jobId);
      // A retry of an apply that committed: the snapshot stored then, and nothing written again.
      const applied = await store.applied(ctx.workspaceId, input.idempotencyKey);
      if (applied) {
        // Another candidate's, another preview's or another reason's key: never that result, never a second write.
        if (
          applied.result.candidateId !== snapshot.candidateId ||
          applied.result.jobId !== snapshot.jobId ||
          applied.previewId !== input.previewId ||
          applied.reason !== input.reason
        )
          throw new ScoreChangeError('idempotency_conflict');
        return applied.result;
      }
      const { before, after, changes, previewId } = await prepare(ctx, snapshot, input);
      if (previewId !== input.previewId) throw new ScoreChangeError('stale');
      if (changes.length === 0) return snapshot;
      const appliedAt = now();
      // Ratings that move nothing now are stored on the snapshot they leave as it is: no second, identical snapshot.
      const row: StoredAssessment = sameResult(after, before)
        ? snapshot
        : { ...snapshot, ...after, id: newId(), assessedAt: appliedAt };
      if (row !== snapshot) await store.insert(row);
      await store.insertInterviewChanges(
        changes.map(({ change }) => ({
          ...change,
          id: newId(),
          workspaceId: ctx.workspaceId,
          candidateId: row.candidateId,
          jobId: row.jobId,
          resultId: row.id,
          idempotencyKey: input.idempotencyKey,
          previewId,
          reason: input.reason,
          appliedBy: ctx.userId,
          appliedAt,
        })),
      );
      // One entry per rating, moved or not, so the person's word is on record; the last statements before commit (3.6).
      for (const { competencyId, rating, from, to } of changes)
        await auditScoreChange(ctx, {
          candidateId: row.candidateId,
          note: input.reason,
          before: {
            resultId: snapshot.id,
            competencyId,
            strength: from.strength,
            provenLevel: from.provenLevel,
            backedScore: before.backedScore,
          },
          after: {
            resultId: row.id,
            competencyId,
            strength: to.strength,
            provenLevel: to.provenLevel,
            backedScore: after.backedScore,
            rating,
            interviewId: input.interviewId,
          },
        });
      return row;
    },
  };
}
