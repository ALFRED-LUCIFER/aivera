import type { Tx } from '@aivera/db';
import type { Action, WorkspaceContext } from '@aivera/workspaces';
import { CandidateError, normaliseIdentifiers, type Identifier, type Person } from '../domain/person.ts';

/** The store over one workspace-scoped transaction. Every method filters by `workspaceId`. */
export type CandidateStore = {
  /** The earliest-created person holding any of `identifiers`, followed through a merge; null when none. */
  findPersonId(workspaceId: string, identifiers: Identifier[]): Promise<string | null>;
  /** Inserts the person and their identifiers; false, with nothing written, when an identifier is already taken. */
  insertPerson(person: Person, identifiers: Identifier[]): Promise<boolean>;
  /** Adds the identifiers no person holds yet to the person, and their emails and phones to its record. */
  attachIdentifiers(workspaceId: string, personId: string, identifiers: Identifier[]): Promise<void>;
  getPerson(workspaceId: string, personId: string): Promise<Person | null>;
  listPeople(workspaceId: string): Promise<Person[]>;
  /** Deletes every person and identifier in the workspace; false, with nothing deleted, if any person is not synthetic. */
  deleteSyntheticPeople(workspaceId: string): Promise<boolean>;
};

export type Ports = {
  storeFor(tx: Tx): CandidateStore;
  /** Writes `PersonCreated.v1` to the outbox in `tx`, so it commits only with the person (AIV-P0-014). */
  publishPersonCreated(tx: Tx, person: Person): Promise<void>;
  /** The workspaces contract's `authorize`: role, and for job-scoped roles a job grant (ADR-005 point 6). */
  authorize(ctx: WorkspaceContext, action: Action): Promise<void>;
  /** Whether the context's workspace is flagged synthetic (the workspaces contract's `getWorkspace`). */
  isSyntheticWorkspace(ctx: WorkspaceContext): Promise<boolean>;
  newId(): string;
  now(): Date;
};

/** What an application or import knows about the person. Its caller (a server action, route handler or job) validates the shape with zod (AGENTS.md 3.7). */
export type FindOrCreatePersonInput = {
  displayName: string;
  identifiers: Identifier[];
  location?: string | null;
  /** Required, so no seed or import can forget it (AGENTS.md 1.1). */
  synthetic: boolean;
};

export type FindOrCreatePersonResult = { personId: string; created: boolean };

export function peopleUseCases({ storeFor, publishPersonCreated, authorize, isSyntheticWorkspace, newId, now }: Ports) {
  return {
    async findOrCreatePerson(ctx: WorkspaceContext, input: FindOrCreatePersonInput): Promise<FindOrCreatePersonResult> {
      await authorize(ctx, 'candidate.create');
      const identifiers = normaliseIdentifiers(input.identifiers);
      const displayName = input.displayName.trim();
      if (!displayName) throw new CandidateError('display_name');
      const store = storeFor(ctx.tx);

      // shortcut: when identifiers match two different people, the earliest wins and keeps only the identifiers no one
      // holds; duplicate detection and merge (AIV-P1-018) resolve the rest.
      const found = await store.findPersonId(ctx.workspaceId, identifiers);
      if (found) {
        await store.attachIdentifiers(ctx.workspaceId, found, identifiers);
        return { personId: found, created: false };
      }

      const person: Person = {
        id: newId(),
        workspaceId: ctx.workspaceId,
        displayName,
        emails: identifiers.filter((i) => i.type === 'email').map((i) => i.value),
        phones: identifiers.filter((i) => i.type === 'phone').map((i) => i.value),
        location: input.location?.trim() || null,
        synthetic: input.synthetic,
        mergedIntoId: null,
        createdAt: now(),
      };
      if (await store.insertPerson(person, identifiers)) {
        await publishPersonCreated(ctx.tx, person);
        return { personId: person.id, created: true };
      }

      // Another request created this person between the lookup and the insert; theirs is committed, so visible now.
      const raced = await store.findPersonId(ctx.workspaceId, identifiers);
      if (!raced) throw new Error('person identifier taken but no person holds it');
      await store.attachIdentifiers(ctx.workspaceId, raced, identifiers);
      return { personId: raced, created: false };
    },

    // shortcut: a hiring owner or interviewer is refused (no job named); they reach a person through their
    // application's job once applications land (AIV-P1-017).
    async getPerson(ctx: WorkspaceContext, personId: string): Promise<Person | null> {
      await authorize(ctx, 'candidate.view');
      return storeFor(ctx.tx).getPerson(ctx.workspaceId, personId);
    },

    /** The demo seed's reset (AIV-P0-031): admins; refuses a workspace holding anyone not synthetic. */
    async purgeSyntheticPeople(ctx: WorkspaceContext): Promise<void> {
      await authorize(ctx, 'workspace.settings');
      if (!(await isSyntheticWorkspace(ctx))) throw new CandidateError('not_synthetic');
      if (!(await storeFor(ctx.tx).deleteSyntheticPeople(ctx.workspaceId))) throw new CandidateError('not_synthetic');
    },

    // shortcut: no paging; the people page (AIV-P1-048) adds it.
    async listPeople(ctx: WorkspaceContext): Promise<Person[]> {
      await authorize(ctx, 'candidate.view');
      return storeFor(ctx.tx).listPeople(ctx.workspaceId);
    },
  };
}
