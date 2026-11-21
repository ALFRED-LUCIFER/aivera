// The only public surface of @credalent/candidates (ADR-002).
import type { EventDefinition } from '@credalent/db/outbox';
import type { JobResource, WorkspaceContext } from '@credalent/workspaces';
import { z } from 'zod';
import type { FindOrCreatePersonInput, FindOrCreatePersonResult } from '../application/people.ts';
import type { Person } from '../domain/person.ts';

export { CandidateError, IDENTIFIER_TYPES, PERSONAL_DATA_FIELDS } from '../domain/person.ts';
export type { CandidateErrorCode, Identifier, IdentifierType, Person } from '../domain/person.ts';
export type { FindOrCreatePersonInput, FindOrCreatePersonResult } from '../application/people.ts';

/**
 * Written to `candidates.outbox` in the transaction that creates a person, and sent to the `candidates` queue.
 * Strict and opaque ids only: an email or a name in the payload is refused (AGENTS.md 1.2, 3.1). The envelope
 * (`Envelope` from `@credalent/db`) carries the workspace id and the time.
 */
export const PersonCreatedV1 = {
  type: 'PersonCreated.v1',
  payload: z.strictObject({ personId: z.uuid() }),
} satisfies EventDefinition<{ personId: string }>;

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
  /**
   * Display names by person id, for a job's applicant list (AIV-P1-086): `candidate.view` on `job`, so hiring owners
   * and interviewers need a grant on it (`ForbiddenError`). The caller passes only that job's applicants' ids.
   */
  displayNames(ctx: WorkspaceContext, job: JobResource, personIds: string[]): Promise<Map<string, string>>;
  /** Every person not merged into another, oldest first. Admins and recruiters. */
  listPeople(ctx: WorkspaceContext): Promise<Person[]>;
  /**
   * Deletes every person in the workspace, for the demo seed's reset (AIV-P0-031); the workspaces purge follows in the
   * same `ctx.tx` and its `workspace.purged` audit entry covers these deletes too. Admins. Throws `CandidateError('not_synthetic')`, deleting nothing, unless the workspace and everyone in it is synthetic.
   */
  purgeSyntheticPeople(ctx: WorkspaceContext): Promise<void>;
}
