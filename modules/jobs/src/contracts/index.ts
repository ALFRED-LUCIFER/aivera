// The only public surface of @aivera/jobs (ADR-002).
import type { WorkspaceContext } from '@aivera/workspaces';
import type { CreateJobInput, SaveRubricInput } from '../application/jobs.ts';
import type { Job, Rubric, RubricVersion } from '../domain/job.ts';

export { JOB_TYPE_CATALOGUE, JOB_TYPE_CATALOGUE_VERSION, JOB_TYPES } from '../domain/job-types.ts';
export type { JobType, JobTypeEntry } from '../domain/job-types.ts';
export { COMPETENCY_ORIGINS, COMPETENCY_TYPES, JOB_STAGES, JobError, RUBRIC_STATUSES } from '../domain/job.ts';
export type {
  Competency,
  Job,
  JobErrorCode,
  JobStage,
  PayBand,
  Rubric,
  RubricStatus,
  RubricVersion,
} from '../domain/job.ts';
export type { CreateJobInput, SaveRubricInput } from '../application/jobs.ts';

/**
 * Emitted when a hiring owner approves a rubric version. Opaque ids only (AGENTS.md 3.1).
 * shortcut: defined but not yet published; the outbox (AIV-P0-014) carries it from approveRubric.
 */
export type RubricApprovedV1 = {
  type: 'RubricApproved.v1';
  workspaceId: string;
  jobId: string;
  rubricVersionId: string;
  supersededVersionId: string | null;
  occurredAt: string;
};

/**
 * Emitted when a job is published to the candidate site. Opaque ids only.
 * shortcut: defined but not yet published; publishing (AIV-P1-015) sends it through the outbox (AIV-P0-014).
 */
export type JobPublishedV1 = {
  type: 'JobPublished.v1';
  workspaceId: string;
  jobId: string;
  occurredAt: string;
};

/**
 * Every call takes the request context from `WorkspacesContract.withWorkspace` and runs in its scoped transaction,
 * so the workspace id never comes from client input (ADR-005). Hiring owners and interviewers reach only the jobs
 * they are granted, in the repository and in row-level security (ADR-005 point 6). Role checks go through the
 * workspaces `authorize`; refusals throw `ForbiddenError`, rule failures `JobError`.
 */
export interface JobsContract {
  /** Admins and recruiters. A client id must be one of the workspace's clients that is not archived. Audited. */
  createJob(ctx: WorkspaceContext, input: CreateJobInput): Promise<Job>;
  /** The job, or null when it does not exist or the context's job scope does not reach it. Every role. */
  getJob(ctx: WorkspaceContext, jobId: string): Promise<Job | null>;
  /** The jobs the context may see, oldest first. Every role; job-scoped roles get their granted jobs only. */
  listJobs(ctx: WorkspaceContext): Promise<Job[]>;
  /** What assessment reads: the approved version and its competencies, or null when none is approved. */
  getApprovedRubric(ctx: WorkspaceContext, jobId: string): Promise<Rubric | null>;
  /**
   * Admins and recruiters. Edits the version not yet approved in place (back to draft) or starts the next version;
   * the approved version stays in force. Throws `JobError` (`weights_total` "Weights must total 100%.", `level`, …).
   */
  saveRubric(ctx: WorkspaceContext, jobId: string, input: SaveRubricInput): Promise<RubricVersion>;
  /** Admins and recruiters: a draft goes to the hiring owner for approval. */
  submitRubric(ctx: WorkspaceContext, rubricVersionId: string): Promise<void>;
  /** Admins and the job's granted hiring owner. The previous approved version becomes superseded. Audited. */
  approveRubric(ctx: WorkspaceContext, rubricVersionId: string): Promise<void>;
}
