// The only public surface of @credalent/evidence (ADR-002).
import type { EventDefinition } from '@credalent/db/outbox';
import type { WorkspaceContext } from '@credalent/workspaces';
import { z } from 'zod';
import type { CvParseView, CvStatusView, RequestCvParseInput } from '../application/cvParse.ts';
import type { DocumentReadView, RequestDocumentReadInput } from '../application/documentRead.ts';
import type { LinkReadView, RequestLinkReadInput } from '../application/linkRead.ts';
import type {
  EvidenceItemView,
  RecordEvidenceInput,
  RecordEvidenceResult,
  RecordInterviewSummaryInput,
  RecordReferenceCallInput,
} from '../application/evidence.ts';
import type { Comparison } from '../domain/corroboration.ts';
import type { EvidenceMappingView } from '../application/mapping.ts';
import type { EvidenceRequestView } from '../application/requests.ts';
import type { RepositoryReadView, RequestRepositoryReadInput, SkillGradeView } from '../application/repositoryRead.ts';
import type { CompetencyLink } from '../domain/evidence.ts';
import type { DuplicateFlag, DuplicateResolution } from '../domain/fingerprint.ts';

export {
  EvidenceError,
  PERSONAL_DATA_FIELDS,
  PROVENANCES,
  REFERENCE_ROLES,
  SOURCE_KINDS,
  STRENGTHS,
} from '../domain/evidence.ts';
export type {
  CompetencyLink,
  EvidenceErrorCode,
  EvidenceItem,
  EvidenceSource,
  Provenance,
  ReferenceRole,
  SourceKind,
  Strength,
} from '../domain/evidence.ts';
export type {
  EvidenceItemView,
  RecordEvidenceInput,
  RecordEvidenceResult,
  RecordInterviewSummaryInput,
  RecordReferenceCallInput,
} from '../application/evidence.ts';
export type { Comparison, ComparisonOutcome } from '../domain/corroboration.ts';
export { DUPLICATE_RESOLUTIONS, NEAR_DUPLICATE_THRESHOLD } from '../domain/fingerprint.ts';
export type { DuplicateFlag, DuplicateResolution } from '../domain/fingerprint.ts';
export type { RepositoryReadView, RequestRepositoryReadInput, SkillGradeView } from '../application/repositoryRead.ts';
export { COVERAGE_GAPS, GRADE_REASONS, SKILL_GRADES } from '../domain/skill-signals/classify.ts';
export type { Citation, CoverageGap, GradeReason, SkillGrade } from '../domain/skill-signals/classify.ts';
export { parseRepositoryUrl } from '../domain/repository.ts';
export type { AuthorshipClass, RepositoryReadStatus } from '../domain/repository.ts';
export type { EvidenceRequest, EvidenceRequestView, RequestOutcome } from '../application/requests.ts';
export type { CvParseView, CvStatusView, RequestCvParseInput } from '../application/cvParse.ts';
export { CV_PARSE_STATUSES, NOTE_REASONS } from '../domain/cv.ts';
export type { DocumentReadView, RequestDocumentReadInput } from '../application/documentRead.ts';
export { DOCUMENT_READ_STATUSES } from '../domain/document.ts';
export type { DocumentReadStatus } from '../domain/document.ts';
export type { LinkReadView, RequestLinkReadInput } from '../application/linkRead.ts';
export { LINK_LABEL, LINK_READ_STATUSES } from '../domain/link.ts';
export type { LinkReadStatus } from '../domain/link.ts';
export type { CvParseStatus, NoteReason } from '../domain/cv.ts';
export { DEFAULT_FOLLOW_UP, REQUEST_STATUSES } from '../domain/request.ts';
export type { EvidenceGapRow, EvidenceMappingView, MappingRun } from '../application/mapping.ts';
export { CLAIM_LIMIT } from '../domain/mapping.ts';
export type { EvidenceGap, GapKind, StoredChange } from '../domain/mapping.ts';
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
 * `evidence.github.profile-expand` queues a read for the best public repositories of a GitHub profile a CV links
 * (AIV-P1-112). Strict, opaque ids only: the login stays in `evidence.profile_expansion`.
 */
export const GitHubProfileExpandRequestedV1 = {
  type: 'GitHubProfileExpandRequested.v1',
  payload: z.strictObject({ candidateId: z.uuid(), expansionId: z.uuid() }),
} satisfies EventDefinition<{ candidateId: string; expansionId: string }>;

/**
 * Written to `evidence.outbox` and sent to the `evidence` queue, whose worker job `evidence.repository.refresh-stale`
 * re-reads the candidate's stale repository sources and grades their skill signals against the job's approved rubric
 * version (AIV-P1-072). The pack page (AIV-P2-011, #125) asks for it before a hiring owner decides. Strict, opaque ids only.
 */
export const RepositoryRefreshRequestedV1 = {
  type: 'RepositoryRefreshRequested.v1',
  payload: z.strictObject({ candidateId: z.uuid(), jobId: z.uuid() }),
} satisfies EventDefinition<{ candidateId: string; jobId: string }>;

/**
 * Written to `evidence.outbox` and sent to the `evidence` queue, whose worker job `evidence.mapping` maps the
 * candidate's evidence to the job's approved rubric version (AIV-P1-027). One per candidate and job, fanned out from
 * `EvidenceRecorded.v1` (each job the candidate applied to) and `RubricApproved.v1` (each applicant). Opaque ids only.
 */
export const EvidenceMappingRequestedV1 = {
  type: 'EvidenceMappingRequested.v1',
  payload: z.strictObject({ candidateId: z.uuid(), jobId: z.uuid() }),
} satisfies EventDefinition<{ candidateId: string; jobId: string }>;

/**
 * The ticket's "evidence.mapped": written to `evidence.outbox` with a stored mapping run and sent to the `assessment`
 * queue, whose consumer scores the candidate again (AIV-P1-031). Opaque ids only.
 */
export const EvidenceMappedV1 = {
  type: 'EvidenceMapped.v1',
  payload: z.strictObject({ candidateId: z.uuid(), jobId: z.uuid(), rubricVersionId: z.uuid(), mappingId: z.uuid() }),
} satisfies EventDefinition<{ candidateId: string; jobId: string; rubricVersionId: string; mappingId: string }>;

/**
 * Written to `evidence.outbox` in the transaction in which a person resolves a contradiction, and sent to the
 * `assessment` queue, whose consumer scores that candidate for that job again (AIV-P1-098). `rubricVersionId` is the
 * version the comparison's mapping run was made against. Opaque ids only: no note, limit, excerpt or name.
 */
export const ContradictionResolvedV1 = {
  type: 'ContradictionResolved.v1',
  payload: z.strictObject({
    candidateId: z.uuid(),
    jobId: z.uuid(),
    rubricVersionId: z.uuid(),
    comparisonId: z.uuid(),
  }),
} satisfies EventDefinition<{ candidateId: string; jobId: string; rubricVersionId: string; comparisonId: string }>;

/**
 * Written to `evidence.outbox` with a pending `cv` source and sent to the `evidence` queue, whose worker job
 * `evidence.cv.parse` parses the CV once its file is clean (AIV-P1-025). Strict, opaque ids only.
 */
export const CvParseRequestedV1 = {
  type: 'CvParseRequested.v1',
  payload: z.strictObject({ candidateId: z.uuid(), sourceId: z.uuid() }),
} satisfies EventDefinition<{ candidateId: string; sourceId: string }>;

/**
 * Written to `evidence.outbox` with a pending `document` source and sent to the `evidence` queue, whose worker job
 * `evidence.document.read` reads the document once its file is clean (AIV-P1-028). Strict, opaque ids only.
 */
export const DocumentReadRequestedV1 = {
  type: 'DocumentReadRequested.v1',
  payload: z.strictObject({ candidateId: z.uuid(), sourceId: z.uuid() }),
} satisfies EventDefinition<{ candidateId: string; sourceId: string }>;

/**
 * Written to `evidence.outbox` with a pending `shipped_product` source and sent to the `evidence` queue, whose worker
 * job `evidence.link.read` fetches the link behind the SSRF guard (AIV-P1-077). Strict, opaque ids only: the link
 * stays in `evidence.link_read`.
 */
export const LinkReadRequestedV1 = {
  type: 'LinkReadRequested.v1',
  payload: z.strictObject({ candidateId: z.uuid(), sourceId: z.uuid() }),
} satisfies EventDefinition<{ candidateId: string; sourceId: string }>;

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
  /**
   * Stores a recruiter's reference call notes as a `reference_call` source ("Reference call, 11 Nov") with one
   * Supporting, Candidate-submitted item; who was called is kept by role only (`REFERENCE_ROLES`), never a name. The
   * notes are fingerprinted, so notes copied from the candidate's write-up are one origin with it. Admins and recruiters;
   * anyone else gets `ForbiddenError` and nothing is stored. Throws `EvidenceError` (`reference_role`, `called_on`,
   * `excerpt`) and writes nothing.
   */
  recordReferenceCall(ctx: WorkspaceContext, input: RecordReferenceCallInput): Promise<RecordEvidenceResult>;
  /**
   * Stores what a person confirmed from an interviewer's meeting summary (AIV-P1-115) as an `interview_note` source
   * ("Interviewer's summary, 24 Nov") with one item per changed competency, each citing its excerpt and linked to that
   * competency of the job: Medium and "Candidate-submitted" provenance for a strengthening, Claim only for a
   * weakening, never Strong and never "Independently corroborated", with the limit "The interviewer's summary of the
   * interview: their word, not inspected work." With `from: 'scorecard'` it stores a submitted scorecard's notes
   * (AIV-P2-006) the same way: "Interviewer's scorecard, 26 Nov", one item per rated competency citing its note, with
   * the limit "The interviewer's note on their scorecard: their word, not inspected work." Writes `EvidenceRecorded.v1`. Anyone who may submit a scorecard on the
   * job (`scorecard.submit`: a hiring owner or interviewer needs a grant on it); `ForbiddenError` otherwise, storing
   * nothing. Throws `EvidenceError` (`strength`, `excerpt`, `level`).
   */
  recordInterviewSummary(ctx: WorkspaceContext, input: RecordInterviewSummaryInput): Promise<RecordEvidenceResult>;
  /**
   * The comparisons of the candidate's newest mapping run for the job (AIV-P1-029), oldest first: contradictions (open
   * while `resolvedAt` is null) and agreement facts, each citing both items by id. An open contradiction shows both
   * items as "Contradictory" in `listEvidenceForCandidate`, so the score leaves them out. Every role with a grant on
   * the job.
   */
  listComparisons(ctx: WorkspaceContext, candidateId: string, jobId: string): Promise<Comparison[]>;
  /**
   * A person resolves a contradiction (AIV-P2-063): which of the two items stands (`standingItemId`, or null when both
   * do), a note on why, and the limit the items then state. A standing item shows its own provenance again; the other
   * stays "Contradictory" and counts nowhere. A re-map keeps the resolution while the same two excerpts contradict.
   * Audited (`evidence.contradiction_resolved`: actor, time, note, the standing item) as the last statement; changes no
   * stage, rank or contact. Admins and recruiters. Throws `EvidenceError` (`resolution_note`, `limit`, `standing`,
   * `comparison_not_found`).
   */
  resolveContradiction(
    ctx: WorkspaceContext,
    comparisonId: string,
    input: { note: string; limit: string; standingItemId: string | null },
  ): Promise<void>;
  /**
   * Links an item to a competency of a job's rubric; linking twice keeps one link, at the latest level. A changed level
   * is audited (`evidence.level_changed`: actor, time, `reason`, the old and new level) as the last statement
   * (AIV-P2-063). Admins and recruiters. Throws `EvidenceError` (`level`, `level_reason`, `not_found`).
   */
  linkToCompetency(ctx: WorkspaceContext, itemId: string, link: CompetencyLink, reason: string): Promise<void>;
  /**
   * The candidate's items, oldest first, each with its source and its links to `jobId`'s competencies; items of an
   * earlier mapping run for the job are left out (AIV-P1-027). An empty list when there are none. Admins and recruiters.
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
   * Stores a pending `cv` source (label "CV") for an uploaded CV file and queues its parse (`CvParseRequested.v1`). The
   * worker parses it only once the files module has settled the file clean (FileClean.v1); every statement becomes a
   * claim ("Claim awaiting validation", Claim only) citing "CV, page N", and the CV's emails and phones go to the
   * candidate record only. Admins and recruiters.
   */
  requestCvParse(ctx: WorkspaceContext, input: RequestCvParseInput): Promise<{ sourceId: string }>;
  /**
   * The parse's status (`pending` "Reading the CV", `unreadable` "Could not be read automatically", `waiting` "Waiting for tomorrow's AI allowance", `failed` "Parsing failed,
   * retry", `parsed`) and the CV's "Unusual content in this source" notes, each quoting the CV with "page N", for the
   * Candidate screen (AIV-P1-045). Null when the workspace has no such parse. Admins and recruiters.
   */
  getCvParse(ctx: WorkspaceContext, sourceId: string): Promise<CvParseView | null>;
  /**
   * Reads a CV that could not be read again (AIV-P1-134): a `failed` parse goes back to pending ("Reading the CV…") and
   * `CvParseRequested.v1` is written for the same source (opaque ids), never a new source. Admins and recruiters.
   * Audited (`evidence.retried`). Throws `EvidenceError('cv_not_found')` for no such CV in the workspace, and
   * `EvidenceError('not_retryable')` unless the parse is `failed` (so a second retry while it is pending writes nothing).
   */
  retryCvParse(ctx: WorkspaceContext, sourceId: string): Promise<void>;
  /**
   * Assesses a candidate's evidence for the job again after its mapping failed for good (AIV-P1-165): queues
   * `EvidenceMappingRequested.v1` for that candidate and job only. Admins and recruiters. Audited (`evidence.retried`).
   * Throws `EvidenceError('not_retryable')` when no failure is recorded (so a second retry writes nothing).
   */
  retryMapping(ctx: WorkspaceContext, candidateId: string, jobId: string): Promise<void>;
  /**
   * Each candidate's newest CV parse status and whether mapping their evidence to the job failed for good
   * (AIV-P1-165), in `candidateIds` order: what the ranking and the profile say while a CV is read and assessed. Every
   * role with a grant on the job; a job-scoped member is refused unless every candidate applied to a job they may see.
   */
  listCvStatuses(ctx: WorkspaceContext, jobId: string, candidateIds: string[]): Promise<CvStatusView[]>;
  /**
   * Stores a pending `document` source (the given label, provenance "Candidate-submitted") for an uploaded document,
   * write-up or image and queues its read (`DocumentReadRequested.v1`). The worker reads it only once the files module
   * has settled the file clean (FileClean.v1; FileRejected.v1 marks it unreadable): one item per page, "Candidate-
   * submitted", at most Medium, cited "<label>, page N", with the limit "<label> supplied, authorship unverified."; its
   * text is fingerprinted once and indexed for search. Admins and recruiters. Throws `EvidenceError('source_label')`.
   */
  requestDocumentRead(ctx: WorkspaceContext, input: RequestDocumentReadInput): Promise<{ sourceId: string }>;
  /**
   * The read's status (`pending`, `read`, `unreadable`, `failed`) and the document's "Unusual content in this source"
   * notes, each quoting the document with "page N" (`hidden_text` when the file hides it). Null when the workspace has
   * no such read. Admins and recruiters.
   */
  getDocumentRead(ctx: WorkspaceContext, sourceId: string): Promise<DocumentReadView | null>;
  /**
   * Stores a pending `shipped_product` source (the given label, provenance "Candidate-submitted") for a shipped-product
   * page, published write-up, case study or design share link, and queues its read (`LinkReadRequested.v1`), once per
   * candidate and link as supplied: a second request returns the first `sourceId`. The worker fetches it behind the
   * SSRF guard (https only, no credentials, public addresses only and pinned, at most 3 redirects, 10 s, 2 MB of HTML,
   * robots.txt respected) and stores the page title and one item with the page text, "Candidate-submitted", at most
   * Medium, cited by the label, with the limit "<label> supplied, authorship unverified."; its text is fingerprinted
   * once and indexed for search. A link that cannot be fetched is `not_reachable` and nothing is scored from it.
   * Admins and recruiters. Throws `EvidenceError('source_label')`.
   */
  requestLinkRead(ctx: WorkspaceContext, input: RequestLinkReadInput): Promise<{ sourceId: string }>;
  /**
   * The read's status (`pending`, `read`, `not_reachable` "We could not open this link" beside `url`, `failed`), the
   * label every note is cited by, the page title, and the page's "Unusual content in this source" notes. Null when the
   * workspace has no such read. Admins and recruiters.
   */
  getLinkRead(ctx: WorkspaceContext, sourceId: string): Promise<LinkReadView | null>;
  /**
   * A draft evidence request naming only the candidate's open claims for the job (items resting on "Claim awaiting
   * validation" or "To check in interview"), with the default follow-up policy (after 2 days, at most twice). Audited.
   * Admins and recruiters. Throws `EvidenceError` (`nothing_to_request` "Nothing rests on a claim for this job",
   * `open_request`) and creates nothing.
   */
  createDraftRequest(
    ctx: WorkspaceContext,
    input: { candidateId: string; jobId: string },
  ): Promise<EvidenceRequestView>;
  /**
   * A person sends a draft: status "sent", a portal token issued (stored only as its SHA-256, valid 30 days),
   * `EvidenceRequestSent.v1` written, and `queueEmail` called with the sent request and the token to queue the
   * candidate's email in `ctx.tx` (the notifications module's `queueEmail`). All commit together or not at all
   * (AIV-P2-063): when queuing throws, the request stays a draft, "Not sent", and sending again retries. Audited.
   * Throws `EvidenceError('request_status')` unless a draft, or what `queueEmail` threw.
   */
  sendRequest(
    ctx: WorkspaceContext,
    requestId: string,
    queueEmail: (sent: { request: EvidenceRequestView; portalToken: string }) => Promise<unknown>,
  ): Promise<{ request: EvidenceRequestView; portalToken: string }>;
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
  /**
   * The candidate's newest evidence mapping run for the job (AIV-P1-027), or null before one: the rubric version, the
   * prompt and model its links rest on, its evidence gaps (never negative evidence) and its "What would change this"
   * list (at most 3, each closing a gap or a capped item by id; `text` null when the model named no check).
   * The mapped items themselves come from `listEvidenceForCandidate`. Every role with a grant on the job.
   */
  getEvidenceMapping(ctx: WorkspaceContext, candidateId: string, jobId: string): Promise<EvidenceMappingView | null>;
}
