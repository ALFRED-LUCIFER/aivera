// Builds the intake module for an app (ADR-002: only apps import this).
import type { CandidatesContract } from '@credalent/candidates';
import { enqueue } from '@credalent/db/outbox';
import type { Tx } from '@credalent/db';
import { uuidv7 } from '@credalent/db/uuidv7';
import type { JobsContract } from '@credalent/jobs';
import type { WorkspacesContract } from '@credalent/workspaces';
import { applicationUseCases, type Ports } from './application/applications.ts';
import { ApplicationReceivedV1, type ApplicationReads, type IntakeContract } from './contracts/index.ts';
import { candidatesForJob, intakeStore, jobsForCandidate } from './infrastructure/repository.ts';
import { outbox } from './infrastructure/schema.ts';

/** `now` is the injected clock (AGENTS.md 3.9); tests pass a fixed one. */
export function createIntake(
  workspaces: Pick<WorkspacesContract, 'authorize'>,
  candidates: Pick<CandidatesContract, 'findOrCreatePerson'>,
  jobs: Pick<JobsContract, 'getJob'>,
  /** The candidates composition's `displayNamesInWorkspace` (AIV-P1-086). */
  displayNames: Ports['displayNames'],
  now: () => Date = () => new Date(),
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
    findOrCreatePerson: (ctx, input) => candidates.findOrCreatePerson(ctx, input),
    displayNames,
    jobResource: async (ctx, jobId) => {
      const job = await jobs.getJob(ctx, jobId);
      return job && { jobId: job.id, clientId: job.clientId };
    },
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

/** The worker's application reads (AIV-P1-027). */
export const createApplicationReads = (): ApplicationReads => ({ jobsForCandidate, candidatesForJob });
