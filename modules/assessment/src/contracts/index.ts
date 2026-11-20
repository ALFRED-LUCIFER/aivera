// The only public surface of @credalent/assessment (ADR-002). It imports nothing from billing, candidate-accounts or
// portfolio: paying never changes ranking (AGENTS.md 1.8, architecture rule `paying-never-changes-ranking`).
import type { WorkspaceContext } from '@credalent/workspaces';
import type { AssessCandidateInput, StoredAssessment } from '../application/assessment.ts';

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
export type { AssessCandidateInput, StoredAssessment } from '../application/assessment.ts';

/**
 * Every call takes the request context from `WorkspacesContract.withWorkspace` and runs in its scoped transaction, so
 * the workspace id never comes from client input (ADR-005). Refusals throw `ForbiddenError`.
 */
export interface AssessmentContract {
  /**
   * Scores the candidate for the job from the approved rubric version and their evidence: the backed score (claims
   * count zero), "up to N if claims hold", a level per competency with its cited items, and confidence. Stores the
   * result when it differs from the latest and audits a changed score (`score.changed`). Rejects, advances and sends
   * nothing (AGENTS.md 1.5). Admins and recruiters. Throws `RangeError` for a link level outside 0–5.
   */
  assessCandidate(ctx: WorkspaceContext, input: AssessCandidateInput): Promise<StoredAssessment>;
  /** The latest assessment of the candidate for the job, or null. Admins and recruiters. */
  getLatestAssessment(ctx: WorkspaceContext, candidateId: string, jobId: string): Promise<StoredAssessment | null>;
}
