// The only public surface of @credalent/assessment (ADR-002). It imports nothing from billing or portfolio (AGENTS.md 1.8,
// rule `paying-never-changes-ranking`) nor from candidate-accounts (rule `recruiter-side-no-candidate-accounts`).
import type { WorkspaceContext } from '@credalent/workspaces';
import type { AssessCandidateInput, JobRanking, StoredAssessment } from '../application/assessment.ts';
import type { RankingExplanation } from '../application/explain.ts';
import type { SuggestQuestionsResult, SuggestedQuestions } from '../application/questions.ts';
import type { ApplyScoreChangeInput, ScoreChangeInput, ScoreChangePreview } from '../application/scoreChange.ts';

export { ScoreChangeError } from '../application/scoreChange.ts';
export type {
  ApplyScoreChangeInput,
  ScoreChangeErrorCode,
  ScoreChangeInput,
  ScoreChangePreview,
} from '../application/scoreChange.ts';
export { RATINGS } from '../domain/scoreChange.ts';
export type { CompetencyState, NoChange, Rating } from '../domain/scoreChange.ts';
export type {
  Assessment,
  CompetencyResult,
  Confidence,
  EvidenceLink,
  Level,
  Proven,
  RubricCompetency,
  RubricInput,
} from '../domain/assess.ts';
export type { AssessCandidateInput, JobRanking, RankingRow, StoredAssessment } from '../application/assessment.ts';
export type { RankingExplanation } from '../application/explain.ts';
export type { ExplanationCitation, ExplanationStatement } from '../domain/explain.ts';
export type { SuggestQuestionsResult, SuggestedQuestions } from '../application/questions.ts';
export type { QuestionCitation, SuggestedGap, SuggestedQuestion } from '../domain/questions.ts';

/**
 * Every call takes the request context from `WorkspacesContract.withWorkspace` and runs in its scoped transaction, so
 * the workspace id never comes from client input (ADR-005). Refusals throw `ForbiddenError`.
 */
export interface AssessmentContract {
  /**
   * Scores the candidate for the job from the approved rubric version and their evidence: the backed score (claims
   * count zero), "up to N if claims hold", a level per competency with its cited items, and confidence. Stores the
   * result when it differs from the latest and audits every stored result (`score.changed`). Rejects, advances and sends
   * nothing (AGENTS.md 1.5). Admins and recruiters. Throws `RangeError` for a link level outside 0–5.
   */
  assessCandidate(ctx: WorkspaceContext, input: AssessCandidateInput): Promise<StoredAssessment>;
  /** The latest assessment of the candidate for the job, or null. Admins and recruiters; hiring owners and interviewers on a granted job the candidate applied to. */
  getLatestAssessment(ctx: WorkspaceContext, candidateId: string, jobId: string): Promise<StoredAssessment | null>;
  /**
   * The job's ranking (AIV-P1-031): `awaiting_rubric` until a rubric version is approved; then each candidate's latest
   * result on the approved version, by backed score, then upper bound, then earliest first assessment, ranked from 1.
   * A candidate not yet assessed on that version is not listed. It orders attention only; it rejects and hides nobody
   * (AGENTS.md 1.5). `candidate.view` on the job: admins and recruiters, hiring owners and interviewers on a granted job
   * only; a job the context cannot see throws `ForbiddenError`.
   */
  listRanking(ctx: WorkspaceContext, jobId: string): Promise<JobRanking>;
  /**
   * How many candidates `listRanking` lists for each job (AIV-P1-099): the candidates with a result on the job's approved
   * rubric version who still apply to it (a person merged into another leaves with their application, AIV-P1-018), 0
   * while none is approved. Job ids and counts only. `candidate.view` on every
   * job; a job the context cannot see throws `ForbiddenError`.
   */
  countAssessed(ctx: WorkspaceContext, jobIds: readonly string[]): Promise<Record<string, number>>;
  /**
   * Why the candidate ranks where they do (AIV-P1-033): up to three statements on the latest snapshot, each citing a
   * snapshot fact or an evidence item, with every number filled from the snapshot and none written by the model. A
   * statement with no citation is dropped; when the model is unavailable or its answer is rejected, a template from the
   * same facts is returned with `source: 'template'` ("Summary generated without AI"). Cached per snapshot. Null with
   * no snapshot, or one not on the approved rubric version. `candidate.view` on the job, as `getLatestAssessment`: admins and recruiters, hiring owners and
   * interviewers on a granted job only. It rejects, advances and contacts nobody (AGENTS.md 1.5).
   */
  explainRanking(ctx: WorkspaceContext, candidateId: string, jobId: string): Promise<RankingExplanation | null>;
  /**
   * What an interviewer's ratings would do (AIV-P1-117): strength and proven level before and after per rated competency,
   * and the backed score and upper bound, from the same scoring as `assessCandidate`. Not shown weakens the competency's
   * present evidence to Claim only, except work a second source checked; Partly shown changes nothing; Clearly shown and
   * Strongly shown both add the interview as Medium evidence at the level the job needs, scored like submitted work and
   * labelled the interviewer's word: never Strong, never verified, never a second independent source. A rating that
   * moves nothing now is listed with why (`noChange`). Writes nothing. `candidate.view` on the snapshot's job. Throws
   * `ForbiddenError` for a snapshot of another workspace or none; `ScoreChangeError` `stale` (not the latest snapshot),
   * `not_yet_scored` (evidence the snapshot has not scored), `source_not_found` (no interview of this candidate and job
   * the context can see), `interview_not_held`, `competency_not_in_interview`, `competency_not_in_rubric`; a zod error
   * for a malformed input.
   */
  previewScoreChange(ctx: WorkspaceContext, input: ScoreChangeInput): Promise<ScoreChangePreview>;
  /**
   * Applies a preview a person confirmed, in the caller's transaction: every listed rating stored under its interview
   * (replacing that interview's earlier rating of the competency) so every later assessment on the same rubric version
   * applies it, a new snapshot citing the interview when the score or its citations change, and one `score.changed`
   * audit entry per rating (actor, time, reason, rating, before and after, equal when nothing moved) as the last
   * statements. `stale`, storing nothing, unless `previewId` is what `previewScoreChange` returns now. The same
   * `idempotencyKey` again returns the snapshot of the first time and writes nothing; with another candidate, preview
   * or reason it is `idempotency_conflict`. Only Partly shown ratings that change nothing store nothing. No stage or
   * contact changes. `scorecard.submit` on the snapshot's job; refusals as `previewScoreChange`.
   */
  applyScoreChange(ctx: WorkspaceContext, input: ApplyScoreChangeInput): Promise<StoredAssessment>;
  /**
   * The suggested interview questions stored for the candidate's latest snapshot (AIV-P1-113), read only: no model is
   * called and nothing is written. `no_gaps` when nothing needs live verification, `not_suggested` when there are gaps
   * and nobody asked yet, `suggested` with the stored gaps (each a competency id and its questions, every question
   * citing an evidence item by id, or the rubric line with `itemId` null), `stale` when the evidence has changed the
   * snapshot since they were made. Null with no snapshot, or one not on the approved rubric version. `candidate.view`
   * on the job, as `getLatestAssessment`.
   */
  getSuggestedQuestions(ctx: WorkspaceContext, candidateId: string, jobId: string): Promise<SuggestedQuestions | null>;
  /**
   * Two or three open, job-specific questions for each evidence gap of the latest snapshot, each citing the gap's
   * evidence, with what a strong and a weak answer show: one model call, on demand, stored for that snapshot. A gap
   * is a competency proven below the job's need or resting on a claim, heaviest first, at most 4. Asking again on the
   * same snapshot returns the stored set and calls no model; `no_gaps` calls none either. `budget_exceeded` when the
   * workspace's daily AI budget is spent (no request made), `failed` when the model is unavailable or its answer is
   * rejected twice; neither stores anything. Null as `getSuggestedQuestions`. Guidance for a person: it changes no
   * score, stage or rank, and is not audited (AGENTS.md 1.5). `candidate.view` on the job.
   */
  suggestInterviewQuestions(
    ctx: WorkspaceContext,
    candidateId: string,
    jobId: string,
  ): Promise<SuggestQuestionsResult | null>;
}
