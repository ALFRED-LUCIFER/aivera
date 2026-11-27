// The only public surface of @credalent/intake (ADR-002).
import type { Tx } from '@credalent/db';
import type { EventDefinition } from '@credalent/db/outbox';
import type { WorkspaceContext } from '@credalent/workspaces';
import { z } from 'zod';
import type {
  ApplicationListItem,
  ChooseForInterviewInput,
  ChooseForInterviewResult,
  ReceiveApplicationInput,
  ReceiveApplicationResult,
  ReceiveBatchInput,
} from '../application/applications.ts';

export {
  CHOICE_REASON_MAX,
  chosenOrDecided,
  IntakeError,
  PERSONAL_DATA_FIELDS,
  SOURCES,
  STAGES,
} from '../domain/application.ts';
export type { Source, Stage } from '../domain/application.ts';
export type {
  ApplicationListItem,
  ChooseForInterviewInput,
  ChooseForInterviewResult,
  InterviewPorts,
  ReceiveApplicationInput,
  ReceiveApplicationResult,
  ReceiveBatchInput,
} from '../application/applications.ts';

/**
 * Written to `intake.outbox` in the transaction that records an arrival or a member's link; evidence ingestion
 * consumes it on the `evidence` queue and reads every GitHub repository link (AIV-P1-076). Strict and
 * opaque ids only, so a link or a name in the payload is refused (AGENTS.md 1.2, 3.1).
 */
export const ApplicationReceivedV1 = {
  type: 'ApplicationReceived.v1',
  payload: z.strictObject({ applicationId: z.uuid(), sourceId: z.uuid() }),
} satisfies EventDefinition<{ applicationId: string; sourceId: string }>;

/** Every call takes the request context from `WorkspacesContract.withWorkspace` and runs in its scoped transaction. */
export interface IntakeContract {
  /**
   * Records one arrival: finds or creates the person, creates their application for the job or reuses it (a second
   * arrival adds a source), and writes `ApplicationReceived.v1`. Admins and recruiters. Throws
   * `IntakeError('job_not_found')`, writing nothing, when the job is not in the workspace.
   */
  receiveApplication(ctx: WorkspaceContext, input: ReceiveApplicationInput): Promise<ReceiveApplicationResult>;
  /**
   * Adds the CVs of one save of "Add applicants" under one confirmation (AIV-P1-104): records the batch (who, when, job,
   * wording version, count), receives each arrival with its `batchId`, and audits `intake.batch_confirmed` last, all in
   * the caller's transaction. Admins and recruiters. Throws `IntakeError('confirmation_required')` unless
   * `rightToProcessConfirmed` is `true` and `IntakeError('job_not_found')`, writing nothing. The worker reads only
   * arrivals that carry a batch.
   */
  receiveBatch(
    ctx: WorkspaceContext,
    input: ReceiveBatchInput,
  ): Promise<{ batchId: string; applications: ReceiveApplicationResult[] }>;
  /**
   * A member adds a work link on an application: stored as a `recruiter` source and announced with
   * `ApplicationReceived.v1`, so evidence reads it when it is a GitHub repository and keeps it as a plain link
   * otherwise (AIV-P1-076). Admins and recruiters; hiring owners and interviewers on the application's job only, by
   * a grant on it or its client (`ForbiddenError`, writing nothing). Throws `IntakeError('application_not_found')`.
   */
  addLink(ctx: WorkspaceContext, applicationId: string, url: string): Promise<{ sourceId: string }>;
  /**
   * The job's applicants, newest first, each with the source of their first arrival (AIV-P1-086). Every role with
   * `candidate.view`; hiring owners and interviewers on a granted job only. Throws `IntakeError('job_not_found')` for a
   * job the context cannot see (another workspace's, or not granted), revealing nothing about its applicants.
   */
  listApplicationsForJob(ctx: WorkspaceContext, jobId: string): Promise<ApplicationListItem[]>;
  /**
   * How many applications the job has, from every source, for the job header's "Bring in candidates" stage
   * (AIV-P1-101). Same access and `IntakeError('job_not_found')` as `listApplicationsForJob`.
   */
  countApplications(ctx: WorkspaceContext, jobId: string): Promise<number>;
  /**
   * A person chooses who to interview from the job's ranking, after a preview (AIV-P1-114): each application moves to
   * stage `interview` and gets a Round 1 interview ("structured screen") with the member as interviewer, the
   * candidate's evidence gaps to investigate and no time yet ("Not scheduled yet"). One already at `interview` is
   * skipped and gets no second interview. One `application.stage_changed` audit entry per person (from and to stage,
   * job, interview id, the reason as note) is written last, in the caller's transaction. Nobody is contacted, and
   * nobody not chosen changes (AGENTS.md 1.5). Admins and recruiters on the job (`interview.schedule`; `ForbiddenError`
   * otherwise). Throws, writing nothing: `IntakeError` `reason_required` (empty or over `CHOICE_REASON_MAX` once
   * trimmed), `job_not_found` (another workspace's or an ungranted job), `not_on_job` (any application not of this
   * job); the interviews contract's refusals; a zod error for a malformed input.
   */
  chooseForInterview(ctx: WorkspaceContext, input: ChooseForInterviewInput): Promise<ChooseForInterviewResult>;
  /**
   * The demo seed's reset (`pnpm db:seed --reset`): deletes the workspace's applications, sources and batches. Admins.
   * Throws `IntakeError('not_synthetic')`, deleting nothing, unless the workspace is flagged synthetic. The flag is the
   * only check: applications carry no synthetic mark of their own, so it deletes every one in a flagged workspace.
   */
  purgeSyntheticApplications(ctx: WorkspaceContext): Promise<void>;
}

/**
 * Who applied to what, for the worker in the consumer's workspace-scoped transaction `tx` (AIV-P1-027: evidence mapping
 * runs per candidate and job). Server-side only; never called with a workspace id from client input.
 */
export interface ApplicationReads {
  jobsForCandidate(tx: Tx, workspaceId: string, personId: string): Promise<string[]>;
  candidatesForJob(tx: Tx, workspaceId: string, jobId: string): Promise<string[]>;
}
