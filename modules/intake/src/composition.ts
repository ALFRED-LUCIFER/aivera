// Builds the intake module for an app (ADR-002: only apps import this).
import type { CandidatesContract } from '@credalent/candidates';
import { enqueue } from '@credalent/db/outbox';
import { uuidv7 } from '@credalent/db/uuidv7';
import type { JobsContract } from '@credalent/jobs';
import type { WorkspacesContract } from '@credalent/workspaces';
import { applicationUseCases } from './application/applications.ts';
import { ApplicationReceivedV1, type IntakeContract } from './contracts/index.ts';
import { intakeStore } from './infrastructure/repository.ts';
import { outbox } from './infrastructure/schema.ts';

/** `now` is the injected clock (AGENTS.md 3.9); tests pass a fixed one. */
export function createIntake(
  workspaces: Pick<WorkspacesContract, 'authorize'>,
  candidates: Pick<CandidatesContract, 'findOrCreatePerson'>,
  jobs: Pick<JobsContract, 'getJob'>,
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
    authorize: (ctx, action) => workspaces.authorize(ctx, action),
    findOrCreatePerson: (ctx, input) => candidates.findOrCreatePerson(ctx, input),
    jobExists: async (ctx, jobId) => (await jobs.getJob(ctx, jobId)) !== null,
    newId: () => uuidv7(),
    now,
  });
}
