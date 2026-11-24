// The only public surface of @credalent/candidates (ADR-002).
import type { EventDefinition } from '@credalent/db/outbox';
import type { WorkspaceContext } from '@credalent/workspaces';
import { z } from 'zod';
import type { DuplicateReport, MergePreview } from '../application/merge.ts';
import type { FindOrCreatePersonInput, FindOrCreatePersonResult } from '../application/people.ts';
import type { Person } from '../domain/person.ts';

export {
  CandidateError,
  IDENTIFIER_TYPES,
  MERGE_REASON_MAX,
  PERSONAL_DATA_FIELDS,
  UNNAMED_APPLICANT,
} from '../domain/person.ts';
export type { CandidateErrorCode, Identifier, IdentifierType, Person } from '../domain/person.ts';
export type { LikelyReason } from '../domain/duplicates.ts';
export type { FindOrCreatePersonInput, FindOrCreatePersonResult } from '../application/people.ts';
export type { DuplicateReport, MergePreview, PersonMergeSummary } from '../application/merge.ts';

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
   * When the identifiers match several people, the earliest is returned and every other one that is an exact duplicate
   * (the same email, phone or CV file; a GitHub login only with the same name) is merged into it automatically, audited
   * as the system with "merged automatically: same CV file" and the like (AIV-P1-018), provided the arrival is an exact
   * duplicate of the earliest person too; otherwise nothing merges.
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
  /**
   * For each listed person of the workspace: the people created before them who are likely the same person (the same
   * name, or an email or phone on both records), and the merges into them not undone, each with whether it can still be
   * undone. Never another workspace's people. Admins and recruiters (`candidate.duplicates`).
   */
  detectDuplicates(ctx: WorkspaceContext, personIds: string[]): Promise<DuplicateReport[]>;
  /** What merging `mergedId` into `survivorId` would combine: each one's applications and evidence sources. */
  previewMerge(ctx: WorkspaceContext, survivorId: string, mergedId: string): Promise<MergePreview>;
  /**
   * A person confirms that `mergedId` is `survivorId`: their applications and evidence move to the survivor, nothing is
   * deleted, `mergedId` keeps `mergedIntoId`, and `candidate.merged` is audited with the member, time and reason.
   * Admins and recruiters (`candidate.merge`; `ForbiddenError` otherwise). Throws `CandidateError` (`merge_people`,
   * `merge_reason`).
   */
  mergePeople(
    ctx: WorkspaceContext,
    survivorId: string,
    mergedId: string,
    reason: string,
  ): Promise<{ mergeId: string }>;
  /**
   * Undoes a merge within the workspace's `mergeUndoDays` of it: both people and exactly the applications and evidence
   * that moved are restored, audited as `candidate.unmerged`. Admins (`candidate.unmerge`). Throws `CandidateError`
   * (`merge_not_found`, `undo_expired`, `undo_blocked`, `merge_reason`).
   */
  unmergePeople(ctx: WorkspaceContext, mergeId: string, reason: string): Promise<void>;
}
