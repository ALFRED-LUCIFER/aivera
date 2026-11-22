// Builds the candidates module for an app (ADR-002: only apps import this).
import type { Tx } from '@credalent/db';
import { enqueue } from '@credalent/db/outbox';
import { uuidv7 } from '@credalent/db/uuidv7';
import type { WorkspacesContract } from '@credalent/workspaces';
import { peopleUseCases, recordCvContact } from './application/people.ts';
import { PersonCreatedV1, type CandidatesContract } from './contracts/index.ts';
import { UNNAMED_APPLICANT } from './domain/person.ts';
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
  return (
    person && {
      ...person,
      unnamed: person.displayName === UNNAMED_APPLICANT,
      identifierEmails: await store.identifierEmails(workspaceId, personId),
    }
  );
};

/**
 * Names a still-unnamed person from their CV, as the system, in the worker's transaction (AIV-P1-090). Never overwrites a
 * name: false when the person is already named. The caller audits it.
 */
export const nameUnnamedPerson = (tx: Tx, workspaceId: string, personId: string, name: string) =>
  candidateStore(tx).nameUnnamed(workspaceId, personId, name);

/** `recordCvContact` over the worker's transaction (AIV-P1-025): the CV's contact on the record, never as identifiers. */
export function createContactRecorder() {
  return (tx: Tx, workspaceId: string, personId: string, contact: { emails: string[]; phones: string[] }) =>
    recordCvContact(candidateStore(tx), workspaceId, personId, contact);
}

/**
 * Display names by person id, unauthorised: apps wire it into `createIntake` only, whose `listApplicationsForJob`
 * authorises the job and passes that job's applicants alone (AIV-P1-086). Workspace filter here, row-level security below.
 */
export const displayNamesInWorkspace = (tx: Tx, workspaceId: string, personIds: string[]) =>
  candidateStore(tx).displayNames(workspaceId, personIds);
