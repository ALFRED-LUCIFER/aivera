// The only public surface of @aivera/candidates (ADR-002).
import type { WorkspaceContext } from '@aivera/workspaces';
import type { FindOrCreatePersonInput, FindOrCreatePersonResult } from '../application/people.ts';
import type { Person } from '../domain/person.ts';

export { CandidateError, IDENTIFIER_TYPES, PERSONAL_DATA_FIELDS } from '../domain/person.ts';
export type { CandidateErrorCode, Identifier, IdentifierType, Person } from '../domain/person.ts';
export type { FindOrCreatePersonInput, FindOrCreatePersonResult } from '../application/people.ts';

/**
 * Emitted once when a new person is created. Opaque ids only, never personal data (AGENTS.md 3.1).
 * shortcut: defined but not yet published; the outbox (AIV-P0-014) carries it from findOrCreatePerson.
 */
export type PersonCreatedV1 = {
  type: 'PersonCreated.v1';
  workspaceId: string;
  personId: string;
  occurredAt: string;
};

/**
 * Every call takes the request context from `WorkspacesContract.withWorkspace` and runs in its scoped transaction,
 * so the workspace id never comes from client input (ADR-005). Role checks go through the workspaces `authorize`.
 */
export interface CandidatesContract {
  /**
   * The workspace's person holding any of the identifiers (normalised first), or a new person holding all of them.
   * Admins and recruiters. Throws `CandidateError` (`invalid_identifier`, `no_identifiers`, `display_name`).
   */
  findOrCreatePerson(ctx: WorkspaceContext, input: FindOrCreatePersonInput): Promise<FindOrCreatePersonResult>;
  /** The person, or null when the workspace has no such person. Admins and recruiters. */
  getPerson(ctx: WorkspaceContext, personId: string): Promise<Person | null>;
  /** Every person not merged into another, oldest first. Admins and recruiters. */
  listPeople(ctx: WorkspaceContext): Promise<Person[]>;
  /**
   * Deletes every person in the workspace, for the demo seed's reset (AIV-P0-031); the workspaces purge follows in the
   * same `ctx.tx` and its `workspace.purged` audit entry covers these deletes too. Admins. Throws `CandidateError('not_synthetic')`, deleting nothing, unless the workspace and everyone in it is synthetic.
   */
  purgeSyntheticPeople(ctx: WorkspaceContext): Promise<void>;
}
