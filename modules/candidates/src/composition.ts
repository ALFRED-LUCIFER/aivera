// Builds the candidates module for an app (ADR-002: only apps import this).
import type { Tx } from '@credalent/db';
import { enqueue } from '@credalent/db/outbox';
import { uuidv7 } from '@credalent/db/uuidv7';
import type { WorkspacesContract } from '@credalent/workspaces';
import { peopleUseCases, recordCvContact } from './application/people.ts';
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

/**
 * Reads a person as the system, in a worker job's workspace-scoped transaction with no member (the evidence module's
 * `ApplicationReceived.v1` handler, AIV-P1-076): the workspace filter here, row-level security below it.
 */
export const readPersonAsSystem = async (tx: Tx, workspaceId: string, personId: string) => {
  const store = candidateStore(tx);
  const person = await store.getPerson(workspaceId, personId);
  return person && { ...person, identifierEmails: await store.identifierEmails(workspaceId, personId) };
};

/** `recordCvContact` over the worker's transaction (AIV-P1-025): the CV's contact on the record, never as identifiers. */
export function createContactRecorder() {
  return (tx: Tx, workspaceId: string, personId: string, contact: { emails: string[]; phones: string[] }) =>
    recordCvContact(candidateStore(tx), workspaceId, personId, contact);
}
