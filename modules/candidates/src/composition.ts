// Builds the candidates module for an app (ADR-002: only apps import this).
import { enqueue } from '@credalent/db/outbox';
import { uuidv7 } from '@credalent/db/uuidv7';
import type { WorkspacesContract } from '@credalent/workspaces';
import { peopleUseCases } from './application/people.ts';
import { PersonCreatedV1, type CandidatesContract } from './contracts/index.ts';
import { candidateStore } from './infrastructure/repository.ts';
import { outbox } from './infrastructure/schema.ts';

/**
 * Every call runs in the request's `withWorkspace` transaction (`ctx.tx`), so no pool is needed here.
 * `now` is the injected clock (AGENTS.md 3.9); tests pass a fixed one.
 */
export function createCandidates(
  workspaces: Pick<WorkspacesContract, 'authorize' | 'getWorkspace'>,
  now: () => Date = () => new Date(),
): CandidatesContract {
  return peopleUseCases({
    storeFor: candidateStore,
    publishPersonCreated: (tx, person) =>
      enqueue(tx, outbox, PersonCreatedV1, {
        workspaceId: person.workspaceId,
        payload: { personId: person.id },
        dedupeKey: `person:${person.id}`,
        occurredAt: person.createdAt,
      }),
    authorize: (ctx, action) => workspaces.authorize(ctx, action),
    isSyntheticWorkspace: async (ctx) => (await workspaces.getWorkspace(ctx))?.synthetic === true,
    newId: () => uuidv7(),
    now,
  });
}
