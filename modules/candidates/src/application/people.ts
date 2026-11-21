import type { Tx } from '@credalent/db';
import type { Action, WorkspaceContext } from '@credalent/workspaces';
import {
  CandidateError,
  normaliseIdentifier,
  normaliseIdentifiers,
  type Identifier,
  type Person,
} from '../domain/person.ts';

/** The store over one workspace-scoped transaction. Every method filters by `workspaceId`. */
export type CandidateStore = {
  /** The earliest-created person holding any of `identifiers`, followed through a merge; null when none. */
  findPersonId(workspaceId: string, identifiers: Identifier[]): Promise<string | null>;
  /** Inserts the person and their identifiers; false, with nothing written, when an identifier is already taken. */
  insertPerson(person: Person, identifiers: Identifier[]): Promise<boolean>;
  /** Adds the identifiers no person holds yet to the person, and their emails and phones to its record. */
  attachIdentifiers(workspaceId: string, personId: string, identifiers: Identifier[]): Promise<void>;
  getPerson(workspaceId: string, personId: string): Promise<Person | null>;
  /** Adds emails and phones the record does not list yet to the person's record only: no identifier, no matching. */
  appendContact(workspaceId: string, personId: string, contact: { emails: string[]; phones: string[] }): Promise<void>;
  listPeople(workspaceId: string): Promise<Person[]>;
  /** Each listed person's id and display name; ids the workspace does not have are left out. */
  displayNames(workspaceId: string, personIds: string[]): Promise<{ id: string; displayName: string }[]>;
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

const normalised = (type: 'email' | 'phone', values: string[]) =>
  values.flatMap((value) => {
    try {
      return [normaliseIdentifier({ type, value }).value];
    } catch {
      return [];
    }
  });

/**
 * Adds contact details read from a CV to the person's record, as the system, in the worker's workspace-scoped
 * transaction (AIV-P1-025). They are display contact only, never identifiers: a CV can name a referee or plant someone
 * else's address, so CV contact must never make another applicant match this person. Values that are not a valid
 * email or E.164 phone are skipped.
 */
// shortcut: CV contact is unverified and never matched on; duplicate detection and merge (AIV-P1-018) decides whether
// a CV address may become an identifier.
export async function recordCvContact(
  store: Pick<CandidateStore, 'appendContact'>,
  workspaceId: string,
  personId: string,
  contact: { emails: string[]; phones: string[] },
): Promise<void> {
  const emails = normalised('email', contact.emails);
  const phones = normalised('phone', contact.phones);
  if (emails.length || phones.length) await store.appendContact(workspaceId, personId, { emails, phones });
}
