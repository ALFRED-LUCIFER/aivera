// The only public surface of @credalent/jobs (ADR-002).
import type { Tx } from '@credalent/db';
import type { EventDefinition } from '@credalent/db/outbox';
import type { WorkspaceContext } from '@credalent/workspaces';
import { z } from 'zod';
import type { DetectDomainInput, DomainDetection } from '../application/detect-domain.ts';
import type { CompetencyDraft, DraftInput } from '../application/draft-competencies.ts';
import type {
  CreateJobInput,
  CreateJobWithDraftRubricInput,
  PublishJobInput,
  SaveRubricInput,
} from '../application/jobs.ts';
import type { CatalogueVersion } from '../domain/catalogue.ts';
import type {
  CatalogueEditorView,
  DraftCompetencyInput,
  DraftPackInput,
  RetireEntryInput,
} from '../domain/catalogue-draft.ts';
import type {
  DeskJob,
  Job,
  JobHeader,
  JobStage,
  PublicListing,
  Rubric,
  RubricApproval,
  RubricVersion,
} from '../domain/job.ts';
import type { PublicJob, PublicJobLookup } from '../domain/public-job.ts';

export {
  CATALOGUE_KEY,
  isRegionalHint,
  jobTypeLabel,
  nameKey,
  offeredJobTypes,
  packForJobType,
} from '../domain/catalogue.ts';
export type {
  CatalogueCompetency,
  CatalogueContent,
  CatalogueHint,
  CatalogueJobType,
  CataloguePack,
  CatalogueRegion,
  CatalogueVersion,
  Labels,
  PackForJobType,
} from '../domain/catalogue.ts';
export {
  CatalogueError,
  competencyStatus,
  draftCompetencySchema,
  draftPackSchema,
  isNewInDraft,
  packStatus,
  retireEntrySchema,
} from '../domain/catalogue-draft.ts';
export type {
  CatalogueEditorView,
  CatalogueErrorCode,
  CatalogueField,
  DraftCompetencyInput,
  DraftPackInput,
  EditorCompetency,
  EditorVersion,
  EntryStatus,
  RetireEntryInput,
} from '../domain/catalogue-draft.ts';
export {
  approvesAs,
  COMPETENCY_ORIGINS,
  COMPETENCY_TYPES,
  JOB_STAGES,
  JobError,
  PUBLIC_DESCRIPTOR_MAX,
  RETURN_NOTE_MAX,
  RUBRIC_STATUSES,
} from '../domain/job.ts';
export type {
  Competency,
  DeskJob,
  Job,
  JobErrorCode,
  JobHeader,
  JobStage,
  NextAction,
  PayBand,
  PublicListing,
  Rubric,
  RubricApproval,
  RubricState,
  RubricStatus,
  RubricVersion,
} from '../domain/job.ts';
export type {
  CreateJobInput,
  CreateJobWithDraftRubricInput,
  PublishJobInput,
  SaveRubricInput,
} from '../application/jobs.ts';
export type {
  CompetencyDraft,
  DraftedCompetency,
  DraftInput,
  SuggestedCompetency,
} from '../application/draft-competencies.ts';
export type { DetectDomainInput, DomainDetection } from '../application/detect-domain.ts';
export { SLUG, toPublicJobJson } from '../domain/public-job.ts';
export type { PublicJob, PublicJobLookup } from '../domain/public-job.ts';

/**
 * Written to `jobs.outbox` in the transaction that approves a rubric version (AIV-P1-014), and sent to the `assessment`
 * queue: it is what starts assessment for the job (AIV-P1-031). Strict and opaque ids only (AGENTS.md 1.2, 3.1); the
 * envelope carries the workspace id and the time.
 */
export const RubricApprovedV1 = {
  type: 'RubricApproved.v1',
  payload: z.strictObject({ jobId: z.uuid(), rubricVersionId: z.uuid(), supersededVersionId: z.uuid().nullable() }),
} satisfies EventDefinition<{ jobId: string; rubricVersionId: string; supersededVersionId: string | null }>;

/** Written to `jobs.outbox` in the transaction that lists a job on the candidate site (AIV-P1-015). Opaque ids only. */
export const JobPublishedV1 = {
  type: 'JobPublished.v1',
  payload: z.strictObject({ jobId: z.uuid() }),
} satisfies EventDefinition<{ jobId: string }>;

/** Written to `jobs.outbox` in the transaction that takes a job off the candidate site (AIV-P1-015). */
export const JobUnpublishedV1 = {
  type: 'JobUnpublished.v1',
  payload: z.strictObject({ jobId: z.uuid() }),
} satisfies EventDefinition<{ jobId: string }>;

/**
 * Every call takes the request context from `WorkspacesContract.withWorkspace` and runs in its scoped transaction,
 * so the workspace id never comes from client input (ADR-005). Hiring owners and interviewers reach only the jobs
 * they are granted, in the repository and in row-level security (ADR-005 point 6). Role checks go through the
 * workspaces `authorize`; refusals throw `ForbiddenError`, rule failures `JobError`.
 */
export interface JobsContract {
  /**
   * Admins and recruiters. A client id must be one of the workspace's clients that is not archived; a hiring owner gets
   * a grant on the job (`changeHiringOwner`'s rule). Audited.
   */
  createJob(ctx: WorkspaceContext, input: CreateJobInput): Promise<Job>;
  /**
   * Admins and recruiters (AIV-P1-010): the job and rubric version 1 as a draft, with its competencies, in one
   * transaction. Weights that do not total 100 are rebalanced proportionally; a competency with no name, a weight
   * outside 1–100 or a level outside 1–5 throws `JobError` and nothing is stored. Nothing is assessed from a draft.
   * Audited as `job.created`, with the version id.
   */
  createJobWithDraftRubric(
    ctx: WorkspaceContext,
    input: CreateJobWithDraftRubricInput,
  ): Promise<{ job: Job; rubricVersion: RubricVersion }>;
  /**
   * Admins and recruiters (AIV-P1-056): sets the job's hiring owner (null: none). The new owner gets a grant on the job,
   * the previous one loses theirs (a client grant stays). Throws `ForbiddenError`, `JobError('not_found')`, or the
   * workspaces module's `WorkspaceError('owner_role')` when the owner is not an active hiring owner.
   */
  changeHiringOwner(ctx: WorkspaceContext, jobId: string, ownerId: string | null): Promise<void>;
  /**
   * Admins and recruiters (AIV-P1-067): moves the job to `stage`; the same stage does nothing. Any stage past "defining
   * rubric" needs an approved rubric (`JobError('stage_needs_rubric')`). Audited as `job.stage_changed`.
   */
  changeStage(ctx: WorkspaceContext, jobId: string, stage: JobStage): Promise<void>;
  /** The job, or null when it does not exist or the context's job scope does not reach it. Every role. */
  getJob(ctx: WorkspaceContext, jobId: string): Promise<Job | null>;
  /** The jobs the context may see, oldest first. Every role; job-scoped roles get their granted jobs only. */
  listJobs(ctx: WorkspaceContext): Promise<Job[]>;
  /** The Jobs list rows: `listJobs` with each job's rubric state, next action, and what is not yet available. */
  listJobsForDesk(ctx: WorkspaceContext): Promise<DeskJob[]>;
  /** The job page header (AIV-P1-011), or null when the job does not exist or the context's job scope does not reach it. */
  getJobHeader(ctx: WorkspaceContext, jobId: string): Promise<JobHeader | null>;
  /**
   * Every rubric version of the job with its competencies, newest first, for the rubric page and its approval history
   * (AIV-P1-012). Null as `getJob`. Every role that may view the job.
   */
  listRubricVersions(ctx: WorkspaceContext, jobId: string): Promise<Rubric[] | null>;
  /** What assessment reads: the approved version and its competencies, or null when none is approved. */
  getApprovedRubric(ctx: WorkspaceContext, jobId: string): Promise<Rubric | null>;
  /**
   * Admins and recruiters. Edits the version not yet approved in place (back to draft) or starts the next version;
   * the approved version stays in force. One open version per job: editing resumes it. With no change note given, it is
   * written from the changes to the approved version (AIV-P1-013). `base` is the copy the editor opened; a save from an
   * older copy throws `JobError('stale')` and changes nothing. Throws `JobError` (`weights_total` "Weights must total
   * 100%.", `level`, …).
   */
  saveRubric(ctx: WorkspaceContext, jobId: string, input: SaveRubricInput): Promise<RubricVersion>;
  /**
   * Admins and recruiters: a draft goes to the hiring owner for approval, recorded as sent by the caller; the approved
   * version stays in force. Returns the version as sent. `alongside(sent)` runs in the same transaction before the audit
   * write: the caller queues the approval email there (AIV-P1-014). Audited.
   */
  submitRubric(
    ctx: WorkspaceContext,
    rubricVersionId: string,
    alongside?: (sent: RubricVersion) => Promise<void>,
  ): Promise<RubricVersion>;
  /**
   * The job's own hiring owner, or an admin acting as owner (audited as such), approves the version awaiting approval
   * (AIV-P1-014): the previous approved version becomes superseded and RubricApproved.v1, which starts assessment, is
   * written to the outbox in the same transaction. Anyone else throws `ForbiddenError`. `revision` is the copy the
   * approver read: an older one throws `JobError('stale')`; a version not awaiting approval `version_status`.
   * `alongside` runs in the same transaction before the audit write: the caller queues the decision email there.
   */
  approveRubric(
    ctx: WorkspaceContext,
    rubricVersionId: string,
    revision?: number,
    alongside?: () => Promise<void>,
  ): Promise<void>;
  /**
   * As `approveRubric`, but returns the version with a note of 1 to 1,000 characters (`JobError('return_note')`); the
   * approved version stays in force. Audited with the note.
   */
  returnRubric(
    ctx: WorkspaceContext,
    rubricVersionId: string,
    note: string,
    revision?: number,
    alongside?: () => Promise<void>,
  ): Promise<void>;
  /**
   * The recruiter's desk (AIV-P1-014): per visible job, the version awaiting approval and any approved in the past
   * week, oldest job first. Every role; job-scoped roles get their granted jobs only.
   */
  listRubricApprovals(ctx: WorkspaceContext): Promise<RubricApproval[]>;
  /**
   * Admins and recruiters: what the candidate site would show (the allow-listed listing, from the approved rubric),
   * for the publish preview. Null when no rubric version is approved.
   */
  getPublicListing(ctx: WorkspaceContext, jobId: string): Promise<PublicListing | null>;
  /**
   * Admins and recruiters. Needs an approved rubric (`JobError` `rubric_not_approved`). Writes JobPublished.v1 to the
   * outbox in the same transaction. Audited.
   */
  publishJob(ctx: WorkspaceContext, jobId: string, input: PublishJobInput): Promise<void>;
  /**
   * Admins and recruiters. Unpublishing an unpublished job does nothing. Writes JobUnpublished.v1 to the outbox in the
   * same transaction; applications already received stay where they are. Audited.
   */
  unpublishJob(ctx: WorkspaceContext, jobId: string): Promise<void>;
  /**
   * Deletes every job of the workspace with its rubrics and listings, for the demo seed's reset (AIV-P1-065); the
   * workspaces purge follows in the same `ctx.tx` and its `workspace.purged` audit entry covers these deletes too.
   * Admins. Throws `JobError('not_synthetic')`, deleting nothing, unless the workspace and every job in it is synthetic.
   */
  purgeSyntheticJobs(ctx: WorkspaceContext): Promise<void>;
  /**
   * Hides every public listing of the workspace from the candidate site, or shows them again (AIV-P2-037), keeping
   * whether each is open. Only for the operator's status change, inside its withWorkspace(<workspace>) `tx`.
   */
  pausePublicListings(tx: Tx, workspaceId: string, paused: boolean): Promise<void>;
}

/**
 * "Draft competencies" (AIV-P1-008). Saves nothing and reads nothing from the database. `workspaceId` is only whose
 * daily AI budget pays: the caller must have authorised `job.create` in that workspace first, and must not hold a
 * workspace transaction open across the model call.
 */
export interface CompetencyDrafting {
  /**
   * The competencies the description states, each citing it, and whether a line asking for something that is not a
   * skill was left out. Throws `@credalent/ai`'s `BudgetExceeded`, `AiUnavailable`,
   * or (an answer rejected twice) `SchemaMismatch`, `UncitedOutput` or `InvalidCitation`.
   */
  draftCompetencies(workspaceId: string, input: DraftInput, catalogue: CatalogueVersion): Promise<CompetencyDraft>;
}

/**
 * "Detect the job's industry" (AIV-P1-063). Saves nothing and reads nothing from the database; the same rules for
 * `workspaceId` as `CompetencyDrafting`.
 */
export interface DomainDetecting {
  /**
   * The hiring company's likely industry from `catalogue`'s packs, or `none`, and the job's regions from its regions,
   * each citing the description or the location; pass the published version. An answer the citation contract rejects
   * twice (a domain not in the catalogue, a quote not in the job's text) is `none`. Throws `@credalent/ai`'s
   * `BudgetExceeded` or `AiUnavailable`.
   */
  detectDomain(workspaceId: string, input: DetectDomainInput, catalogue: CatalogueVersion): Promise<DomainDetection>;
}

/**
 * The catalogue (ADR-013): job types, regions, domain packs and regional hints, one version for all. Platform data with
 * no workspace and no personal data, so it needs no session. Everything outside `/ops` reads only the latest published
 * version (point 15); a key is validated against it at every trust boundary (point 7).
 */
export interface CatalogueReads {
  /** The latest published version, retired entries flagged. Throws when the read fails. */
  getPublishedCatalogue(): Promise<CatalogueVersion>;
}

/**
 * The catalogue editor (AIV-P2-045, ADR-013 points 3 to 6, 11, 14): one open draft that every operator edits. For
 * `/ops` only: each call takes the operator id from `platformOperator()`, never from the form, and only
 * server/operator.ts calls the writes (architecture rule `operator-only-writes`). Writes validate their input with zod
 * (a `ZodError` before anything is read), name the draft revision they read, and throw `CatalogueError`: `stale` (with
 * who saved last) when the draft moved on, `no_draft`, `not_found`, and the rule refusals. Each writes its
 * `audit.platform_entry` last in its transaction. Nothing here changes what recruiters see until publish (AIV-P2-049).
 */
export interface CatalogueEditor {
  /** The latest published version and the open draft (null when none), competencies with their positions. */
  getEditor(): Promise<CatalogueEditorView>;
  /** "Start a draft": copies the latest published version. `draft_open` when one is open. `catalogue.draft_opened`. */
  openDraft(operatorId: string): Promise<void>;
  /**
   * Adds a pack (`previousKey` null) or edits its English label; its key only while it is new in the draft
   * (`key_fixed`), never to a key the draft holds (`key_taken`). `catalogue.entry_added` / `catalogue.entry_edited`.
   */
  saveDraftPack(operatorId: string, input: DraftPackInput): Promise<void>;
  /**
   * Adds (`position` null) or edits a pack competency, always desirable. Refused: empty evidence
   * (`evidence_required`), a retired entry (`entry_retired`), a name or meaning naming an employer or where someone is from (`fairness_employer`,
   * `fairness_origin`), a job type the draft does not offer, core outside applies-to, more than `CORE_LIMIT` core per job
   * type in the pack (`core_limit`), a retired pack.
   */
  saveDraftCompetency(operatorId: string, input: DraftCompetencyInput): Promise<void>;
  /**
   * Retires a pack or competency a published version holds (`catalogue.entry_retired`), or removes one new in this
   * draft (`catalogue.entry_removed`). Returns which.
   */
  retireDraftEntry(operatorId: string, input: RetireEntryInput): Promise<'retired' | 'removed'>;
}

/**
 * The candidate site's reads (AIV-P3-002). No workspace and no session: every call runs as the aivera_public database
 * role, which can read the public columns of published jobs and nothing else. Results carry no weight, client name,
 * candidate, score or id; public responses still go out through `publicJobJson`.
 */
export interface PublicJobsContract {
  /** Every open job, newest first. */
  listPublicJobs(): Promise<PublicJob[]>;
  /** The job at this slug: open, no longer open, or null when no job ever had it. */
  findPublicJob(slug: string): Promise<PublicJobLookup>;
}

/**
 * The operator console's job count (ADR-012 point 6), for `/ops` only: a number per workspace, never a job's fields.
 * Runs inside withWorkspace(<that workspace>) as the app role. Callers check the platformOperator policy first.
 */
export interface JobCounts {
  /** Every job of the workspace, any stage; 0 for an unknown workspace. */
  countJobs(workspaceId: string): Promise<number>;
}

/**
 * A job's approved rubric version for the worker (AIV-P1-072), in the consumer's workspace-scoped transaction `tx`:
 * the version id and its competencies in order, or null when none is approved. Server-side only; never called with a
 * workspace id from client input.
 */
export interface ApprovedRubricReads {
  approvedRubric(
    tx: Tx,
    workspaceId: string,
    jobId: string,
  ): Promise<{
    id: string;
    competencies: { id: string; name: string; evidenceExpected: string; weightPercent: number }[];
  } | null>;
}
