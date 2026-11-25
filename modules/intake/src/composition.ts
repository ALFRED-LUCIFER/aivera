// Builds the intake module for an app (ADR-002: only apps import this).
import type { AuditContract } from '@credalent/audit';
import type { CandidatesContract } from '@credalent/candidates';
import { enqueue } from '@credalent/db/outbox';
import type { Tx } from '@credalent/db';
import { uuidv7 } from '@credalent/db/uuidv7';
import type { JobsContract } from '@credalent/jobs';
import type { JobResource, WorkspaceContext, WorkspacesContract } from '@credalent/workspaces';
import { applicationUseCases, type InterviewPorts, type Ports } from './application/applications.ts';
import { ApplicationReceivedV1, type ApplicationReads, type IntakeContract, type Stage } from './contracts/index.ts';
import {
  applicationRecords,
  candidatesForJob,
  findApplication,
  intakeStore,
  jobsForCandidate,
} from './infrastructure/repository.ts';
import { outbox } from './infrastructure/schema.ts';

/**
 * `now` is the injected clock (AGENTS.md 3.9); tests pass a fixed one. `interviews` are what choosing for interview
 * calls (AIV-P1-114): the interviews contract's `createInterview` and the assessment's gaps, as functions so the modules
 * need no package edge; without them `chooseForInterview` throws.
 */
export function createIntake(
  workspaces: Pick<WorkspacesContract, 'authorize' | 'getWorkspace'>,
  candidates: Pick<CandidatesContract, 'findOrCreatePerson'>,
  jobs: Pick<JobsContract, 'getJob'>,
  /** The candidates composition's `displayNamesInWorkspace` (AIV-P1-086). */
  displayNames: Ports['displayNames'],
  audit: Pick<AuditContract, 'record'>,
  now: () => Date = () => new Date(),
  interviews?: InterviewPorts,
): IntakeContract {
  return applicationUseCases({
    storeFor: intakeStore,
    publishApplicationReceived: (tx, source) =>
      enqueue(tx, outbox, ApplicationReceivedV1, {
        workspaceId: source.workspaceId,
        payload: { applicationId: source.applicationId, sourceId: source.id },
        dedupeKey: `application-source:${source.id}`,
        occurredAt: source.receivedAt,
      }),
    authorize: (ctx, action, resource) => workspaces.authorize(ctx, action, resource),
    auditBatchConfirmed: (ctx, batch) =>
      audit.record(
        { tx: ctx.tx, workspaceId: ctx.workspaceId, actor: { type: 'user', id: ctx.userId } },
        {
          action: 'intake.batch_confirmed',
          subject: { type: 'import_batch', id: batch.id },
          after: { jobId: batch.jobId, wordingVersion: batch.wordingVersion, cvs: batch.cvs },
        },
      ),
    auditStageChanged: (ctx, { applicationId, jobId, from, to, interviewId, reason }) =>
      audit.record(
        { tx: ctx.tx, workspaceId: ctx.workspaceId, actor: { type: 'user', id: ctx.userId } },
        {
          action: 'application.stage_changed',
          subject: { type: 'application', id: applicationId },
          note: reason,
          before: { stage: from },
          after: { stage: to, jobId, interviewId },
        },
      ),
    ...(interviews && { interviews }),
    findOrCreatePerson: (ctx, input) => candidates.findOrCreatePerson(ctx, input),
    displayNames,
    jobResource: async (ctx, jobId) => {
      const job = await jobs.getJob(ctx, jobId);
      return job && { jobId: job.id, clientId: job.clientId };
    },
    isSyntheticWorkspace: async (ctx) => (await workspaces.getWorkspace(ctx))?.synthetic === true,
    newId: () => uuidv7(),
    now,
  });
}

/**
 * Reads an arrival's person, links, supplied GitHub login and file ids as the system, in a worker job's workspace-scoped
 * transaction with no member (the evidence module's `ApplicationReceived.v1` handler, AIV-P1-076).
 */
export const readApplicationSourceAsSystem = (tx: Tx, workspaceId: string, sourceId: string) =>
  intakeStore(tx).findSource(workspaceId, sourceId);

/**
 * A person's applications for a duplicate merge (AIV-P1-018): apps wire it into `createCandidates`, whose merge
 * authorises the change and calls it in the merge's transaction. Not authorised itself.
 */
export { applicationRecords };

/**
 * An application's person and job (AIV-P2-001): apps wire it into `createInterviews`, which authorises the job it
 * returns before writing anything. Not authorised itself.
 */
export { findApplication };

/**
 * The demo seed's interviews (AIV-P1-114): moves an application the seed gave an interview to `interview`, as
 * `chooseForInterview` would, so the demo ranking never offers to choose them twice. Not authorised, and it writes no
 * audit entry: tools/seed records `application.stage_changed` itself when this returns true. tools/seed only.
 */
export const markInterviewStageForSeed = (tx: Tx, workspaceId: string, applicationId: string, from: Stage) =>
  intakeStore(tx).moveStage(workspaceId, applicationId, from, 'interview');

/** The worker's application reads (AIV-P1-027). */
export const createApplicationReads = (): ApplicationReads => ({ jobsForCandidate, candidatesForJob });

/**
 * The job a candidate applied to, as the context may see it (AIV-P1-091): null when the candidate has no application on
 * it or the context cannot see the job. Other modules authorise a job-scoped read against this stored record, never
 * against the job id in the request.
 */
export const createCandidateJobResolver =
  (jobs: Pick<JobsContract, 'getJob'>) =>
  async (ctx: WorkspaceContext, candidateId: string, jobId: string): Promise<JobResource | null> => {
    if (!(await jobsForCandidate(ctx.tx, ctx.workspaceId, candidateId)).includes(jobId)) return null;
    const job = await jobs.getJob(ctx, jobId);
    return job && { jobId: job.id, clientId: job.clientId };
  };
