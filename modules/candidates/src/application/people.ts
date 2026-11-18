import type { Tx } from '@aivera/db';
import type { Action, WorkspaceContext } from '@aivera/workspaces';
import { CandidateError, normaliseIdentifiers, type Identifier, type Person } from '../domain/person.ts';

/** The store over one workspace-scoped transaction. Every method filters by `workspaceId`. */
export type CandidateStore = {
  /** The earliest-created person holding any of `identifiers`, followed through a merge; null when none. */
  findPersonId(workspaceId: string, identifiers: Identifier[]): Promise<string | null>;
  /** Inserts the person and their identifiers; false, with nothing written, when an identifier is already taken. */
  insertPerson(person: Person, identifiers: Identifier[]): Promise<boolean>;
  getPerson(workspaceId: string, personId: string): Promise<Person | null>;
  listPeople(workspaceId: string): Promise<Person[]>;
};

export type Ports = {
  storeFor(tx: Tx): CandidateStore;
  /** The workspaces contract's `authorize`: role, and for job-scoped roles a job grant (ADR-005 point 6). */
  authorize(ctx: WorkspaceContext, action: Action): Promise<void>;
  newId(): string;
  now(): Date;
};

/** What an application or import knows about the person. The server action validates its shape with zod. */
export type FindOrCreatePersonInput = {
  displayName: string;
  identifiers: Identifier[];
  location?: string | null;
  /** Required, so no seed or import can forget it (AGENTS.md 1.1). */
  synthetic: boolean;
};

export type FindOrCreatePersonResult = { personId: string; created: boolean };

export function peopleUseCases({ storeFor, authorize, newId, now }: Ports) {
  return {
    async findOrCreatePerson(ctx: WorkspaceContext, input: FindOrCreatePersonInput): Promise<FindOrCreatePersonResult> {
      await authorize(ctx, 'candidate.create');
      const identifiers = normaliseIdentifiers(input.identifiers);
      const displayName = input.displayName.trim();
      if (!displayName) throw new CandidateError('display_name');
      const store = storeFor(ctx.tx);

      // shortcut: when identifiers match two different people, the earliest wins and the rest are not attached;
      // duplicate detection and merge (AIV-P1-018) resolve it.
      const found = await store.findPersonId(ctx.workspaceId, identifiers);
      if (found) return { personId: found, created: false };

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
      // shortcut: PersonCreated.v1 is not published; write it to the outbox here, in ctx.tx, once AIV-P0-014 lands.
      if (await store.insertPerson(person, identifiers)) return { personId: person.id, created: true };

      // Another request created this person between the lookup and the insert; theirs is committed, so visible now.
      const raced = await store.findPersonId(ctx.workspaceId, identifiers);
      if (!raced) throw new Error('person identifier taken but no person holds it');
      return { personId: raced, created: false };
    },

    // shortcut: a hiring owner or interviewer is refused (no job named); they reach a person through their
    // application's job once applications land (AIV-P1-017).
    async getPerson(ctx: WorkspaceContext, personId: string): Promise<Person | null> {
      await authorize(ctx, 'candidate.view');
      return storeFor(ctx.tx).getPerson(ctx.workspaceId, personId);
    },

    // shortcut: no paging; the people page (AIV-P1-048) adds it.
    async listPeople(ctx: WorkspaceContext): Promise<Person[]> {
      await authorize(ctx, 'candidate.view');
      return storeFor(ctx.tx).listPeople(ctx.workspaceId);
    },
  };
}
