// Builds the intake module for an app (ADR-002: only apps import this).
import type { AuditContract } from '@credalent/audit';
import type { CandidatesContract } from '@credalent/candidates';
import type { Handler } from '@credalent/db/consumer';
import { enqueue, type EventDefinition } from '@credalent/db/outbox';
import type { Tx } from '@credalent/db';
import { uuidv7 } from '@credalent/db/uuidv7';
import type { JobsContract } from '@credalent/jobs';
import type { Action, JobResource, WorkspaceContext, WorkspacesContract } from '@credalent/workspaces';
import { applicationUseCases, type InterviewPorts, type Ports } from './application/applications.ts';
import { applyDecisions, type DecisionStagePorts } from './application/decisions.ts';
import { advanceSheetImport, sheetImportUseCases, type SheetWorkerPorts } from './application/sheetImports.ts';
import {
  ApplicationReceivedV1,
  SheetImportRequestedV1,
  type ApplicationReads,
  type IntakeContract,
  type Stage,
} from './contracts/index.ts';
import {
  applicationRecords,
  candidatesForJob,
  findApplication,
  intakeStore,
  jobsForCandidate,
  sheetStore,
} from './infrastructure/repository.ts';
import { readSheetCells } from './infrastructure/sheetFile.ts';
import { inbox, outbox } from './infrastructure/schema.ts';

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
  const jobResource = async (ctx: WorkspaceContext, jobId: string) => {
    const job = await jobs.getJob(ctx, jobId);
    return job && { jobId: job.id, clientId: job.clientId };
  };
  const isSyntheticWorkspace = async (ctx: WorkspaceContext) =>
    (await workspaces.getWorkspace(ctx))?.synthetic === true;
  const authorize = (ctx: WorkspaceContext, action: Action, resource?: JobResource) =>
    workspaces.authorize(ctx, action, resource);
  const applications = applicationUseCases({
    storeFor: intakeStore,
    publishApplicationReceived: (tx, source) =>
      enqueue(tx, outbox, ApplicationReceivedV1, {
        workspaceId: source.workspaceId,
        payload: { applicationId: source.applicationId, sourceId: source.id },
        dedupeKey: `application-source:${source.id}`,
        occurredAt: source.receivedAt,
      }),
    authorize,
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
    jobResource,
    isSyntheticWorkspace,
    newId: () => uuidv7(),
    now,
  });
  const sheets = sheetImportUseCases({
    sheetStoreFor: sheetStore,
    publishSheetStep: (tx, sheet) =>
      enqueue(tx, outbox, SheetImportRequestedV1, {
        workspaceId: sheet.workspaceId,
        payload: { sheetImportId: sheet.id },
        dedupeKey: `sheet-import:${sheet.id}:${sheet.status}`,
        occurredAt: now(),
      }),
    authorize,
    jobResource,
    receiveBatch: applications.receiveBatch,
    isSyntheticWorkspace,
    newId: () => uuidv7(),
    now,
  });
  return { ...applications, ...sheets };
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

/**
 * The worker job for the decisions module's `DecisionsRecorded.v1` (AIV-P2-012): moves each decided candidate's
 * application to "Round 2 shortlist" or "Not advanced" (a hold keeps its stage) and audits each move with the hiring
 * owner as actor and their reason, once per message id (`intake.inbox`). The event and the read of the pack's
 * decisions come from the worker's composition root, so intake needs no package edge to decisions (which depends on
 * intake through evidence). Nothing here contacts a candidate (AGENTS.md 1.5).
 */
export const createDecisionStageHandler = (config: {
  event: EventDefinition<{ packId: string; jobId: string }>;
  decisionsOf: DecisionStagePorts['decisionsOf'];
  audit: Pick<AuditContract, 'record'>;
}): Handler<{ packId: string; jobId: string }> => {
  const ports: DecisionStagePorts = {
    storeFor: intakeStore,
    decisionsOf: config.decisionsOf,
    auditStageChanged: (tx, workspaceId, { applicationId, jobId, packId, from, to, decidedBy, note }) =>
      config.audit.record(
        { tx, workspaceId, actor: { type: 'user', id: decidedBy } },
        {
          action: 'application.stage_changed',
          subject: { type: 'application', id: applicationId },
          note,
          before: { stage: from },
          after: { stage: to, jobId, packId },
        },
      ),
  };
  return {
    event: config.event,
    inbox,
    consumer: 'intake.stage.decisions-recorded',
    handle: (tx, payload, envelope) => applyDecisions(ports, tx, envelope.workspaceId, payload),
  };
};

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

/**
 * The worker job for `SheetImportRequested.v1` (AIV-P1-103): reads an imported sheet's header row, or, once the
 * recruiter confirmed the mapping, its rows and their CV links. `readCleanFile` and `fetchCv` come from the files
 * composition (`createCleanFileReader`, `createCvLinkFetcher`), so intake needs no package edge to files. Nothing is
 * added to the job here: the recruiter confirms that. No sheet value is logged.
 */
export const createSheetImportHandler = (config: {
  readCleanFile: (
    tx: Tx,
    workspaceId: string,
    fileId: string,
  ) => Promise<{ purpose: string; contentType: string; data: Buffer } | 'pending' | 'rejected'>;
  fetchCv: SheetWorkerPorts['fetchCv'];
}): Handler<{ sheetImportId: string }> => {
  const ports: SheetWorkerPorts = {
    sheetStoreFor: sheetStore,
    readSheet: async (tx, workspaceId, fileId) => {
      const file = await config.readCleanFile(tx, workspaceId, fileId);
      // The web action starts an import only for a clean upload, so a pending one is a retry, not a refusal.
      if (file === 'pending') throw new Error('sheet upload not scanned yet');
      return file === 'rejected' || file.purpose !== 'candidate_sheet'
        ? 'unreadable'
        : readSheetCells(file.data, file.contentType);
    },
    fetchCv: config.fetchCv,
  };
  return {
    event: SheetImportRequestedV1,
    inbox,
    consumer: 'intake.sheet-import',
    handle: (tx, payload, envelope) => advanceSheetImport(ports, tx, envelope.workspaceId, payload.sheetImportId),
  };
};
