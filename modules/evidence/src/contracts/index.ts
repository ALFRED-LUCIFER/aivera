// The only public surface of @credalent/evidence (ADR-002).
import type { EventDefinition } from '@credalent/db/outbox';
import type { WorkspaceContext } from '@credalent/workspaces';
import { z } from 'zod';
import type { EvidenceItemView, RecordEvidenceInput, RecordEvidenceResult } from '../application/evidence.ts';
import type { EvidenceRequestView } from '../application/requests.ts';
import type { RepositoryReadView, RequestRepositoryReadInput, SkillGradeView } from '../application/repositoryRead.ts';
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
export type { RepositoryReadView, RequestRepositoryReadInput, SkillGradeView } from '../application/repositoryRead.ts';
export { COVERAGE_GAPS, GRADE_REASONS, SKILL_GRADES } from '../domain/skill-signals/classify.ts';
export type { Citation, CoverageGap, GradeReason, SkillGrade } from '../domain/skill-signals/classify.ts';
export { parseRepositoryUrl } from '../domain/repository.ts';
export type { AuthorshipClass, RepositoryReadStatus } from '../domain/repository.ts';
export type { EvidenceRequest, EvidenceRequestView, RequestOutcome } from '../application/requests.ts';
export { DEFAULT_FOLLOW_UP, REQUEST_STATUSES } from '../domain/request.ts';
export type { OpenClaim, RequestStatus } from '../domain/request.ts';

const requestEvent = <T extends string>(type: T) =>
  ({
    type,
    payload: z.strictObject({ requestId: z.uuid(), candidateId: z.uuid(), jobId: z.uuid() }),
  }) satisfies EventDefinition<{ requestId: string; candidateId: string; jobId: string }>;

/**
 * An evidence request's life after a person sent it (AIV-P1-037), written to `evidence.outbox` with the change: the
 * ticket's `evidence_request.sent`, `.opened`, `.answered` and `.quiet`. Strict, opaque ids only (AGENTS.md 1.2, 3.1).
 */
export const EvidenceRequestSentV1 = requestEvent('EvidenceRequestSent.v1');
export const EvidenceRequestOpenedV1 = requestEvent('EvidenceRequestOpened.v1');
export const EvidenceRequestAnsweredV1 = requestEvent('EvidenceRequestAnswered.v1');
export const EvidenceRequestQuietV1 = requestEvent('EvidenceRequestQuiet.v1');

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
 * Written to `evidence.outbox` with a pending repository source and sent to the `evidence` queue, whose worker job
 * `evidence.repository.read` reads the repository (AIV-P1-026). Strict, opaque ids only: the link, login and emails
 * stay in `evidence.repository_read`.
 */
export const RepositoryReadRequestedV1 = {
  type: 'RepositoryReadRequested.v1',
  payload: z.strictObject({ candidateId: z.uuid(), sourceId: z.uuid() }),
} satisfies EventDefinition<{ candidateId: string; sourceId: string }>;

/**
 * Written to `evidence.outbox` and sent to the `evidence` queue, whose worker job `evidence.repository.refresh-stale`
 * re-reads the candidate's stale repository sources and grades their skill signals against the job's approved rubric
 * version (AIV-P1-072). AIV-P2-010 asks for it before it builds a decision pack. Strict, opaque ids only.
 */
export const RepositoryRefreshRequestedV1 = {
  type: 'RepositoryRefreshRequested.v1',
  payload: z.strictObject({ candidateId: z.uuid(), jobId: z.uuid() }),
} satisfies EventDefinition<{ candidateId: string; jobId: string }>;

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
  /**
   * Stores a pending `repository` source for a public https://github.com/<owner>/<repository> link and queues its read
   * (`RepositoryReadRequested.v1`), once per candidate and normalised URL (lower case, no `.git`, trailing slash, query
   * or fragment): a second request returns the first read's `sourceId` and queues nothing. Commits count as the
   * candidate's only when they match `githubLogin` (null when they supplied none: emails only, strength cap Medium),
   * one of `emails` or a Co-authored-by trailer naming them. Admins and recruiters. Throws `EvidenceError`
   * (`repository_url`, `github_login`) and writes nothing.
   */
  requestRepositoryRead(ctx: WorkspaceContext, input: RequestRepositoryReadInput): Promise<{ sourceId: string }>;
  /**
   * The read's status and measured numbers, with the authorship share evidence mapping caps strength by (generated-only
   * commits left out); `share` and `strengthCap` are null unless read. Null when the workspace has no such read.
   * Admins and recruiters.
   */
  getRepositoryRead(ctx: WorkspaceContext, sourceId: string): Promise<RepositoryReadView | null>;
  /**
   * A draft evidence request naming only the candidate's open claims for the job (items resting on "Claim awaiting
   * validation" or "Awaiting live defence"), with the default follow-up policy (after 2 days, at most twice). Audited.
   * Admins and recruiters. Throws `EvidenceError` (`nothing_to_request` "Nothing rests on a claim for this job",
   * `open_request`) and creates nothing.
   */
  createDraftRequest(
    ctx: WorkspaceContext,
    input: { candidateId: string; jobId: string },
  ): Promise<EvidenceRequestView>;
  /**
   * A person sends a draft: status "sent", a portal token issued (stored only as its SHA-256, valid 30 days) and
   * returned once, `EvidenceRequestSent.v1` written. Audited. Throws `EvidenceError('request_status')` unless a draft.
   */
  sendRequest(ctx: WorkspaceContext, requestId: string): Promise<{ request: EvidenceRequestView; portalToken: string }>;
  /** A person closes the request. Audited. Throws `EvidenceError('request_status')` when already closed. */
  closeRequest(ctx: WorkspaceContext, requestId: string): Promise<void>;
  /** The request with its items, or null when the workspace has none. Admins and recruiters. */
  getRequest(ctx: WorkspaceContext, requestId: string): Promise<EvidenceRequestView | null>;
  /**
   * Queues `RepositoryRefreshRequested.v1`: the worker re-reads the candidate's repository sources that are stale (last
   * checked more than 30 days ago, or pushed to since) and grades every read source's skill signals against the job's
   * approved rubric version. Admins and recruiters.
   */
  requestRepositoryRefresh(ctx: WorkspaceContext, candidateId: string, jobId: string): Promise<void>;
  /**
   * The candidate's repository skill grades for a rubric version (AIV-P1-072): one per read repository source, target
   * skill and competency, with up to six file citations and a reason code. The recruiter copy is in
   * `evidence.skillGrade` (`grade.<grade>`; `reason.<code>` for Strong and Partial, `noEvidence` with `filesInspected`, `unableToVerify` with `unableReason.<code>`). NO_EVIDENCE and
   * UNABLE_TO_VERIFY are never a negative signal or a reason to reject (AGENTS.md 1.6). Admins and recruiters.
   */
  listRepositorySkillGrades(
    ctx: WorkspaceContext,
    candidateId: string,
    rubricVersionId: string,
  ): Promise<SkillGradeView[]>;
}
