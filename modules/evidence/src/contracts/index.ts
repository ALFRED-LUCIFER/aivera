// The only public surface of @credalent/evidence (ADR-002).
import type { EventDefinition } from '@credalent/db/outbox';
import type { WorkspaceContext } from '@credalent/workspaces';
import { z } from 'zod';
import type { EvidenceItemView, RecordEvidenceInput, RecordEvidenceResult } from '../application/evidence.ts';
import type { CompetencyLink } from '../domain/evidence.ts';
import type { DuplicateFlag, DuplicateResolution } from '../domain/fingerprint.ts';

export { EvidenceError, PERSONAL_DATA_FIELDS, PROVENANCES, SOURCE_KINDS, STRENGTHS } from '../domain/evidence.ts';
export type {
  CompetencyLink,
  EvidenceErrorCode,
  EvidenceItem,
  EvidenceSource,
  Provenance,
  SourceKind,
  Strength,
} from '../domain/evidence.ts';
export type { EvidenceItemView, RecordEvidenceInput, RecordEvidenceResult } from '../application/evidence.ts';
export { DUPLICATE_RESOLUTIONS, NEAR_DUPLICATE_THRESHOLD } from '../domain/fingerprint.ts';
export type { DuplicateFlag, DuplicateResolution } from '../domain/fingerprint.ts';

/**
 * The ticket's "evidence.recorded": written to `evidence.outbox` in the transaction that records a source and its
 * items, and sent to the `assessment` queue so the candidate is assessed again (AIV-P1-031). Strict and opaque ids only
 * (AGENTS.md 1.2, 3.1); the envelope carries the workspace id and the time.
 */
export const EvidenceRecordedV1 = {
  type: 'EvidenceRecorded.v1',
  payload: z.strictObject({ candidateId: z.uuid(), sourceId: z.uuid(), itemIds: z.array(z.uuid()) }),
} satisfies EventDefinition<{ candidateId: string; sourceId: string; itemIds: string[] }>;

/**
 * Every call takes the request context from `WorkspacesContract.withWorkspace` and runs in its scoped transaction,
 * so the workspace id never comes from client input (ADR-005). Role checks go through the workspaces `authorize`;
 * refusals throw `ForbiddenError`, rule failures `EvidenceError`.
 */
export interface EvidenceContract {
  /**
   * Stores one source and the items it backs, with their competency links, and writes `EvidenceRecorded.v1` in the
   * same transaction. Admins and recruiters. Throws `EvidenceError` (`claim_strength` "A claim cannot be stronger than
   * Supporting", `limit` "State what this evidence does not show", `provenance`, `strength`, …) and writes nothing.
   */
  recordEvidence(ctx: WorkspaceContext, input: RecordEvidenceInput): Promise<RecordEvidenceResult>;
  /** Links an item to a competency of a job's rubric; linking twice keeps one link. Admins and recruiters. */
  linkToCompetency(ctx: WorkspaceContext, itemId: string, link: CompetencyLink): Promise<void>;
  /**
   * The candidate's items, oldest first, each with its source and its links to `jobId`'s competencies; an empty list
   * when there are none. Admins and recruiters.
   */
  listEvidenceForCandidate(ctx: WorkspaceContext, candidateId: string, jobId: string): Promise<EvidenceItemView[]>;
  /** The item with its source and every competency link, or null when the workspace has none. Admins and recruiters. */
  getEvidenceItem(ctx: WorkspaceContext, itemId: string): Promise<EvidenceItemView | null>;
  /**
   * The candidate's source ids grouped into origins, oldest first (AIV-P1-071): near-duplicate sources (by text
   * fingerprint, similarity at least `NEAR_DUPLICATE_THRESHOLD`) form one origin, so one write-up never counts as two
   * independent origins (AIV-P1-029). A source with no fingerprint is its own origin. Admins and recruiters.
   */
  listOriginGroups(ctx: WorkspaceContext, candidateId: string): Promise<string[][]>;
  /**
   * "Also submitted by another applicant" flags on either side of which the candidate stands, oldest first: raised by
   * `recordEvidence` when another candidate's source in this workspace is a near-duplicate, never across workspaces.
   * Each cites both sources by opaque id. A flag changes no score, rank, stage or contact. Admins and recruiters.
   */
  listDuplicateFlags(ctx: WorkspaceContext, candidateId: string): Promise<DuplicateFlag[]>;
  /**
   * A person resolves a flag with a reason; resolving again replaces the reason. Audited (`evidence.flag_resolved`:
   * actor, time, reason) as the last statement. Admins and recruiters. Throws `EvidenceError` (`resolution`,
   * `flag_not_found`).
   */
  resolveDuplicateFlag(ctx: WorkspaceContext, flagId: string, resolution: DuplicateResolution): Promise<void>;
  /**
   * Deletes all the workspace's evidence, for the demo seed's reset (AIV-P0-031); the workspaces purge follows in the
   * same `ctx.tx` and its `workspace.purged` audit entry covers these deletes too. Admins. Throws
   * `EvidenceError('not_synthetic')`, deleting nothing, unless the workspace and all its evidence is synthetic.
   */
  purgeSyntheticEvidence(ctx: WorkspaceContext): Promise<void>;
}
