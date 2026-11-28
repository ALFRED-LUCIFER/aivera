import type { Tx } from '@credalent/db';
import type { Action, WorkspaceContext } from '@credalent/workspaces';
import { AUTO_MERGE_NOTES, exactReason } from '../domain/duplicates.ts';
import {
  CandidateError,
  MERGE_REASON_MAX,
  NAME_MAX,
  normaliseIdentifier,
  normaliseIdentifiers,
  type Identifier,
  type IdentifierType,
  type Person,
} from '../domain/person.ts';

/** The store over one workspace-scoped transaction. Every method filters by `workspaceId`. */
export type CandidateStore = {
  /**
   * Every person holding any of `identifiers`, each followed through merges to the person it is now part of, with the
   * identifier types that matched them; earliest-created first.
   */
  findPeople(workspaceId: string, identifiers: Identifier[]): Promise<{ person: Person; types: IdentifierType[] }[]>;
  /** Inserts the person and their identifiers; false, with nothing written, when an identifier is already taken. */
  insertPerson(person: Person, identifiers: Identifier[]): Promise<boolean>;
  /** Adds the identifiers no person holds yet to the person, and their emails and phones to its record. */
  attachIdentifiers(workspaceId: string, personId: string, identifiers: Identifier[]): Promise<void>;
  getPerson(workspaceId: string, personId: string): Promise<Person | null>;
  /** The person's email identifiers: the addresses they applied with, never CV contact (`appendContact`). */
  identifierEmails(workspaceId: string, personId: string): Promise<string[]>;
  /** Adds emails and phones the record does not list yet to the person's record only: no identifier, no matching. */
  appendContact(workspaceId: string, personId: string, contact: { emails: string[]; phones: string[] }): Promise<void>;
  listPeople(workspaceId: string): Promise<Person[]>;
  /** Sets the name only while it is still `UNNAMED_APPLICANT`; false when the person is named, merged away or missing. */
  nameUnnamed(workspaceId: string, personId: string, name: string): Promise<boolean>;
  /** Sets the name of a person not merged into another; false, with nothing written, when there is no such person. */
  rename(workspaceId: string, personId: string, name: string): Promise<boolean>;
  /** Each listed person's id and display name; ids the workspace does not have are left out. */
  displayNames(workspaceId: string, personIds: string[]): Promise<{ id: string; displayName: string }[]>;
  /** Deletes every merge, person and identifier in the workspace; false, with nothing deleted, if any person is not synthetic. */
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
  /**
   * The merge use cases' `merge` (AIV-P1-018), so an arrival that proves two records are one person merges them. Apps
   * that never merge (the seed) leave it out: the earliest exact match is then used and the others stay as they are.
   */
  autoMerge?: (ctx: WorkspaceContext, survivorId: string, mergedId: string, reason: string) => Promise<unknown>;
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

export function peopleUseCases({
  storeFor,
  publishPersonCreated,
  authorize,
  isSyntheticWorkspace,
  newId,
  now,
  autoMerge,
}: Ports) {
  /**
   * The earliest person the arrival exactly duplicates (domain/duplicates.ts), or the earliest match when it exactly
   * duplicates none, gets the identifiers no one holds (one another person holds is never attached); every later exact
   * duplicate is merged into it, as the system, with the reason as the audit note. A merge stands on both halves: the
   * arrival is exactly both people, or nothing merges and the likely-duplicate prompt leaves it to a person (AGENTS.md 1.5).
   */
  // shortcut: an undone automatic merge merges again when a later arrival bridges the same two people; record a
  // "not the same person" decision and skip that pair once a recruiter needs undo to stick (AIV-P1-018 follow-up).
  async function useMatches(
    ctx: WorkspaceContext,
    displayName: string,
    identifiers: Identifier[],
    matches: { person: Person; types: IdentifierType[] }[],
  ): Promise<FindOrCreatePersonResult | null> {
    const exact = matches.flatMap(({ person, types }) => {
      const reason = exactReason(types, displayName, person.displayName);
      return reason ? [{ person, reason }] : [];
    });
    const target = exact[0] ?? matches[0];
    if (!target) return null;
    await storeFor(ctx.tx).attachIdentifiers(ctx.workspaceId, target.person.id, identifiers);
    if (autoMerge)
      for (const other of exact.slice(1))
        await autoMerge(ctx, target.person.id, other.person.id, AUTO_MERGE_NOTES[other.reason]);
    return { personId: target.person.id, created: false };
  }

  return {
    async findOrCreatePerson(ctx: WorkspaceContext, input: FindOrCreatePersonInput): Promise<FindOrCreatePersonResult> {
      await authorize(ctx, 'candidate.create');
      const identifiers = normaliseIdentifiers(input.identifiers);
      const displayName = input.displayName.trim();
      if (!displayName) throw new CandidateError('display_name');
      const store = storeFor(ctx.tx);

      const found = await useMatches(
        ctx,
        displayName,
        identifiers,
        await store.findPeople(ctx.workspaceId, identifiers),
      );
      if (found) return found;

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
      const raced = await useMatches(
        ctx,
        displayName,
        identifiers,
        await store.findPeople(ctx.workspaceId, identifiers),
      );
      if (!raced) throw new Error('person identifier taken but no person holds it');
      return raced;
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

    // shortcut: no paging; add it when a page lists a workspace's people from here (Candidates reads the rankings).
    async listPeople(ctx: WorkspaceContext): Promise<Person[]> {
      await authorize(ctx, 'candidate.view');
      return storeFor(ctx.tx).listPeople(ctx.workspaceId);
    },
  };
}

export type CorrectNameInput = { name: string; reason: string };

/**
 * A person corrects a candidate's display name (AIV-P1-165 §8): admins and recruiters (`candidate.rename`), with a
 * reason. The audit entry, written last, holds the member, the time and the reason, never either name (AGENTS.md 1.2).
 */
export function correctNameUseCase(ports: {
  storeFor: Ports['storeFor'];
  authorize: Ports['authorize'];
  /** Appends `candidate.renamed` to the audit log in `ctx.tx`, as the member. */
  audit(ctx: WorkspaceContext, personId: string, reason: string): Promise<void>;
}) {
  return async (ctx: WorkspaceContext, personId: string, input: CorrectNameInput): Promise<void> => {
    await ports.authorize(ctx, 'candidate.rename');
    const name = input.name.trim().replace(/\s+/g, ' ');
    const reason = input.reason.trim();
    if (!name) throw new CandidateError('display_name');
    if (name.length > NAME_MAX) throw new CandidateError('name_too_long');
    if (!reason || reason.length > MERGE_REASON_MAX) throw new CandidateError('name_reason');
    if (!(await ports.storeFor(ctx.tx).rename(ctx.workspaceId, personId, name)))
      throw new CandidateError('person_not_found');
    // The last statement before commit (AGENTS.md 3.6).
    await ports.audit(ctx, personId, reason);
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
// CV contact never becomes an identifier: an address on two records only makes them a likely duplicate, which a person
// confirms (AIV-P1-018, domain/duplicates.ts).
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
