// The only public surface of @credalent/decisions (ADR-002).
import type { EventDefinition } from '@credalent/db/outbox';
import type { WorkspaceContext } from '@credalent/workspaces';
import { z } from 'zod';
import type {
  CreatePackInput,
  MemberInput,
  PackSummary,
  PackView,
  RecordDecisionsInput,
} from '../application/packs.ts';

export { PackError } from '../domain/pack.ts';
export type { Decision, DecisionPack, DecisionValue, PackMember, PackStatus } from '../domain/pack.ts';
export type {
  CreatePackInput,
  MemberInput,
  PackSummary,
  PackView,
  RecordDecisionsInput,
} from '../application/packs.ts';
export { NAME_MAX } from '../domain/pack.ts';

const packEvent = z.strictObject({ packId: z.uuid(), jobId: z.uuid() });

/**
 * Written to `decisions.outbox` in the transaction that creates a pack. Strict and opaque ids only, so a name or a
 * score in the payload is refused (AGENTS.md 1.2, 3.1).
 */
export const PackReadyV1 = {
  type: 'PackReady.v1',
  payload: packEvent,
} satisfies EventDefinition<z.infer<typeof packEvent>>;

/**
 * Written once per `recordDecisions`, in its transaction, the same shape as `PackReady.v1`. It carries no decision:
 * the read a system consumer needs is not built (`getPack` is for members with `pack.view`) and belongs to the
 * consumer's ticket. It is not a notification: nothing here contacts a candidate (AGENTS.md 1.5).
 */
export const DecisionsRecordedV1 = {
  type: 'DecisionsRecorded.v1',
  payload: packEvent,
} satisfies EventDefinition<z.infer<typeof packEvent>>;

/** Every call takes the request context from `WorkspacesContract.withWorkspace` and runs in its scoped transaction. */
export interface DecisionsContract {
  /**
   * A pack for one job on its approved rubric version, `ready`, with at least one member; each member carries a
   * snapshot of their latest assessment (its id, backed score and "up to N"), which later score changes never touch.
   * A candidate named twice is taken once. Writes `PackReady.v1`. Admins and recruiters on the job (`pack.prepare`).
   * Throws, writing nothing: `PackError` `job_not_found` (unknown, or hidden from the context),
   * `rubric_not_approved`, `candidate_not_assessed` (not ranked on the approved version); `ForbiddenError` for any
   * other role; a zod error for a malformed input.
   */
  createPack(ctx: WorkspaceContext, input: CreatePackInput): Promise<{ packId: string }>;
  /**
   * Adds candidates after the pack's last member, each with their snapshot taken now; one already in the pack is
   * ignored and keeps the snapshot it has. Admins and recruiters on the job. Throws `PackError` `pack_not_found`,
   * `pack_decided`, `candidate_not_assessed` (also once the job's approved rubric version is no longer the pack's).
   */
  addMembers(ctx: WorkspaceContext, packId: string, members: MemberInput[]): Promise<{ added: number }>;
  /**
   * The job's packs, newest first, each with its name, status and members' candidate ids in pack order (AIV-P2-010):
   * the ranking's "Add to decision pack" and its "In shortlist pack". No scores or decisions. Admins, recruiters and
   * hiring owners on the job (`pack.view`); `ForbiddenError` for an interviewer. Throws `PackError('job_not_found')`
   * for a job the context cannot see.
   */
  listPacks(ctx: WorkspaceContext, jobId: string): Promise<PackSummary[]>;
  /**
   * The pack, its members in order and its decisions, or null when it does not exist or its job is hidden from the
   * context. Admins, recruiters and hiring owners on the job (`pack.view`); `ForbiddenError` for an interviewer.
   */
  getPack(ctx: WorkspaceContext, packId: string): Promise<PackView | null>;
  /**
   * Records one decision with its reason for every member, once: the pack becomes `decided`, one
   * `DecisionsRecorded.v1` is written, and each decision is audited (`decision.recorded`: who, when, why). Only the
   * member named as the job's hiring owner: `ForbiddenError` (HTTP 403) for anyone else, storing nothing. It changes
   * no stage and contacts no candidate. Throws `PackError` `pack_not_found`, `pack_decided`, `pack_not_ready`,
   * `decisions_incomplete` (a member missing, named twice, or a candidate not in the pack).
   */
  recordDecisions(ctx: WorkspaceContext, input: RecordDecisionsInput): Promise<void>;
}
