import type { NewEntry } from '@aivera/audit';
import type { Tx } from '@aivera/db';
import type { Action, Client, JobResource, SetJobOwnerInput, WorkspaceContext } from '@aivera/workspaces';
import {
  assertTransition,
  assertValidCompetencies,
  assertValidPayBand,
  describeChanges,
  editsInPlace,
  JobError,
  nextAction,
  rebalanceWeights,
  toPublicListing,
  validPublicDescriptor,
  type Competency,
  type DeskJob,
  type Job,
  type JobHeader,
  type PublicListing,
  type Rubric,
  type RubricVersion,
} from '../domain/job.ts';
import { slugFor } from '../domain/public-job.ts';

/**
 * The store over one workspace-scoped transaction. Every method filters by `workspaceId`, and every job read also by
 * the transaction's job scope (ADR-005 point 6), so a hiring owner's query returns only granted jobs.
 */
export type JobStore = {
  insertJob(job: Job): Promise<void>;
  getJob(workspaceId: string, jobId: string, opts?: { lock: boolean }): Promise<Job | null>;
  listJobs(workspaceId: string): Promise<Job[]>;
  /** Per job with any rubric version: whether one is approved, and the latest version's status. */
  rubricStates(workspaceId: string): Promise<{ jobId: string; approved: boolean; latest: RubricVersion['status'] }[]>;
  /** The job's highest-numbered version, or null when it has none. */
  latestVersion(workspaceId: string, jobId: string): Promise<RubricVersion | null>;
  getVersion(workspaceId: string, versionId: string): Promise<RubricVersion | null>;
  /** Every version of the job, newest first. */
  listVersions(workspaceId: string, jobId: string): Promise<RubricVersion[]>;
  approvedVersion(workspaceId: string, jobId: string): Promise<RubricVersion | null>;
  competencies(workspaceId: string, versionId: string): Promise<Competency[]>;
  insertVersion(version: RubricVersion, competencies: Competency[]): Promise<void>;
  /** Replaces a not-yet-approved version's statement, note, revision and competencies, and sets it back to draft. */
  replaceDraft(version: RubricVersion, competencies: Competency[]): Promise<void>;
  setHiringOwner(workspaceId: string, jobId: string, hiringOwnerUserId: string | null): Promise<void>;
  /** Sets whether the job is listed on the candidate site, with its descriptor and publish time. */
  setPublication(
    workspaceId: string,
    jobId: string,
    publication: Pick<Job, 'published' | 'publicDescriptor' | 'publishedAt'>,
  ): Promise<void>;
  /**
   * Writes the job's public listing (AIV-P3-002), open. A job published before keeps its first slug, so its links
   * keep working; everything else is replaced.
   */
  upsertPublicJob(row: PublicJobRow): Promise<void>;
  /** Marks the job's public listing as no longer open. */
  closePublicJob(workspaceId: string, jobId: string): Promise<void>;
  /** Hides (or shows again) every public listing of the workspace, open or not, without changing `open`. */
  pausePublicJobs(workspaceId: string, paused: boolean): Promise<void>;
  setStatus(
    workspaceId: string,
    versionId: string,
    status: RubricVersion['status'],
    approval?: { by: string; at: Date },
  ): Promise<void>;
  /** Deletes every job of the workspace and its rubrics and listings; false, deleting nothing, if any is not synthetic. */
  deleteSyntheticJobs(workspaceId: string): Promise<boolean>;
};

export type Ports = {
  storeFor(tx: Tx): JobStore;
  /** The workspaces contract's `authorize`: role, and for job-scoped roles a job grant (ADR-005 point 6). */
  authorize(ctx: WorkspaceContext, action: Action, resource?: JobResource): Promise<void>;
  /** The workspaces contract's `listClients`, to check a job's client belongs to the workspace. */
  listClients(ctx: WorkspaceContext): Promise<Client[]>;
  /**
   * The workspaces contract's `setJobOwner` (AIV-P1-056): the hiring owner gets the job's grant, the previous one loses
   * it. Refuses an owner who is not an active hiring owner.
   */
  setJobOwner(ctx: WorkspaceContext, input: SetJobOwnerInput): Promise<void>;
  /** Whether the context's workspace is flagged synthetic (AGENTS.md 1.1). */
  isSyntheticWorkspace(ctx: WorkspaceContext): Promise<boolean>;
  /** The audit contract's `record` in `ctx.tx`; always the last write before commit (AGENTS.md 3.6). */
  audit(ctx: WorkspaceContext, entry: NewEntry): Promise<void>;
  newId(): string;
  now(): Date;
};

/** What the new-job form knows. Its server action validates the shape with zod (AGENTS.md 3.7). */
export type CreateJobInput = Pick<Job, 'title' | 'jobType' | 'description' | 'synthetic'> &
  Partial<Pick<Job, 'team' | 'clientId' | 'location' | 'hiringOwnerUserId' | 'payBand'>>;

/** A new job with its first rubric's competencies, in display order (AIV-P1-010). */
export type CreateJobWithDraftRubricInput = CreateJobInput & { competencies: Competency[] };

/**
 * A rubric as the recruiter saves it; competencies in display order. `base` is the version the editor opened (the open
 * draft, or the approved version when none is open) and its revision; a save from an older copy is refused. With no
 * `changeNote`, the note is written from the changes to the approved version.
 */
export type SaveRubricInput = {
  successStatement: string;
  changeNote?: string | null;
  competencies: Competency[];
  base?: { versionId: string; revision: number };
};

/** One row of the candidate site's read model, as the publishing transaction writes it. */
export type PublicJobRow = {
  jobId: string;
  workspaceId: string;
  slug: string;
  listing: PublicListing & { descriptor: string };
  postedAt: Date;
};

/** What the recruiter confirms in the publish preview. */
export type PublishJobInput = { publicDescriptor: string };

const resourceOf = (job: Job): JobResource => ({ jobId: job.id, clientId: job.clientId });

export function jobsUseCases({
  storeFor,
  authorize,
  listClients,
  setJobOwner,
  isSyntheticWorkspace,
  audit,
  newId,
  now,
}: Ports) {
  /** The job if the context may see it (row-level security and the repository hide the rest), else `not_found`. */
  async function visibleJob(ctx: WorkspaceContext, jobId: string, action: Action, lock = false): Promise<Job> {
    const job = await storeFor(ctx.tx).getJob(ctx.workspaceId, jobId, { lock });
    if (!job) throw new JobError('not_found');
    await authorize(ctx, action, resourceOf(job));
    return job;
  }

  /**
   * Writes the published job's public listing from its approved rubric, in the same transaction (AIV-P3-002).
   * shortcut: a job published before AIV-P3-002 has no listing until it is published again or its next rubric version
   * is approved (no publish screen existed, so none is expected); a migration cannot backfill, as FORCE RLS hides
   * every workspace's jobs from the migrator.
   */
  async function writePublicJob(
    ctx: WorkspaceContext,
    job: Job,
    versionId: string,
    publicDescriptor: string,
    postedAt: Date,
  ) {
    const store = storeFor(ctx.tx);
    const listing = toPublicListing({ ...job, publicDescriptor }, await store.competencies(ctx.workspaceId, versionId));
    // The last 48 random bits of a fresh UUIDv7 (its head is a timestamp): unique across every workspace's same-titled
    // jobs in practice, and says nothing about the job's id. Ignored when the job already has a listing.
    const slug = slugFor(job.title, newId().slice(-12));
    await store.upsertPublicJob({
      jobId: job.id,
      workspaceId: ctx.workspaceId,
      slug,
      listing: { ...listing, descriptor: publicDescriptor },
      postedAt,
    });
  }

  /** Validates and inserts a new job at stage "defining rubric"; the caller has authorised `job.create` and audits. */
  async function insertNewJob(ctx: WorkspaceContext, input: CreateJobInput): Promise<Job> {
    const title = input.title.trim();
    if (!title) throw new JobError('title');
    const payBand = input.payBand ?? null;
    assertValidPayBand(payBand);
    const clientId = input.clientId ?? null;
    // listClients checks client.manage, which allows the same roles as job.create.
    if (clientId && !(await listClients(ctx)).some((c) => c.id === clientId && !c.archivedAt))
      throw new JobError('client_not_found');
    const job: Job = {
      id: newId(),
      workspaceId: ctx.workspaceId,
      title,
      jobType: input.jobType,
      description: input.description.trim(),
      team: input.team?.trim() || null,
      clientId,
      location: input.location?.trim() || null,
      hiringOwnerUserId: input.hiringOwnerUserId ?? null,
      stage: 'defining_rubric',
      published: false,
      publicDescriptor: null,
      publishedAt: null,
      payBand,
      synthetic: input.synthetic,
      createdBy: ctx.userId,
      createdAt: now(),
    };
    await storeFor(ctx.tx).insertJob(job);
    return job;
  }

  /**
   * The new job's hiring owner gets its grant, and only it (AIV-P1-056); setJobOwner refuses anyone but an active hiring
   * owner. Called after the job's own writes, so only audit entries follow (AGENTS.md 3.6).
   */
  async function grantOwner(ctx: WorkspaceContext, job: Job) {
    if (job.hiringOwnerUserId)
      await setJobOwner(ctx, { jobId: job.id, previousOwnerId: null, ownerId: job.hiringOwnerUserId });
  }

  return {
    async createJob(ctx: WorkspaceContext, input: CreateJobInput): Promise<Job> {
      await authorize(ctx, 'job.create');
      const job = await insertNewJob(ctx, input);
      await grantOwner(ctx, job);
      await audit(ctx, {
        action: 'job.created',
        subject: { type: 'job', id: job.id },
        after: { clientId: job.clientId, hiringOwnerUserId: job.hiringOwnerUserId },
      });
      return job;
    },

    /**
     * Saves a new job with its first rubric (AIV-P1-010), in the one transaction: the job, version 1 as a draft and its
     * competencies in display order, weights rebalanced to total 100. Nothing is written when any of it is refused.
     */
    async createJobWithDraftRubric(
      ctx: WorkspaceContext,
      input: CreateJobWithDraftRubricInput,
    ): Promise<{ job: Job; rubricVersion: RubricVersion }> {
      await authorize(ctx, 'job.create');
      const competencies = rebalanceWeights(input.competencies);
      assertValidCompetencies(competencies);
      const job = await insertNewJob(ctx, input);
      const rubricVersion: RubricVersion = {
        id: newId(),
        workspaceId: ctx.workspaceId,
        jobId: job.id,
        version: 1,
        status: 'draft',
        // The success statement is written on the rubric page (AIV-P1-012), before approval.
        successStatement: '',
        changeNote: null,
        createdBy: ctx.userId,
        createdAt: job.createdAt,
        approvedBy: null,
        approvedAt: null,
        revision: 0,
      };
      await storeFor(ctx.tx).insertVersion(rubricVersion, competencies);
      await grantOwner(ctx, job);
      await audit(ctx, {
        action: 'job.created',
        subject: { type: 'job', id: job.id },
        after: {
          clientId: job.clientId,
          hiringOwnerUserId: job.hiringOwnerUserId,
          rubricVersionId: rubricVersion.id,
          rubricStatus: rubricVersion.status,
        },
      });
      return { job, rubricVersion };
    },

    /**
     * Admins and recruiters (AIV-P1-056): the job's hiring owner becomes `ownerId` (null: none). The new owner gets a
     * grant on the job and the previous one loses theirs, audited by the workspaces module as the last writes. No screen
     * calls it yet: the job edit page (AIV-P1-012 job header) will; the ticket's revoke test exercises it now.
     */
    async changeHiringOwner(ctx: WorkspaceContext, jobId: string, ownerId: string | null): Promise<void> {
      const job = await visibleJob(ctx, jobId, 'job.assign_owner', true);
      if (job.hiringOwnerUserId === ownerId) return;
      await storeFor(ctx.tx).setHiringOwner(ctx.workspaceId, job.id, ownerId);
      await setJobOwner(ctx, { jobId: job.id, previousOwnerId: job.hiringOwnerUserId, ownerId });
    },

    /** Null when the job does not exist or the context's job scope does not reach it. */
    async getJob(ctx: WorkspaceContext, jobId: string): Promise<Job | null> {
      const job = await storeFor(ctx.tx).getJob(ctx.workspaceId, jobId);
      if (!job) return null;
      await authorize(ctx, 'job.view', resourceOf(job));
      return job;
    },

    // shortcut: no paging; the jobs list screen (AIV-P1-007) adds it.
    async listJobs(ctx: WorkspaceContext): Promise<Job[]> {
      await authorize(ctx, 'job.list');
      return storeFor(ctx.tx).listJobs(ctx.workspaceId);
    },

    /** The Jobs list: every visible job with its rubric state and next action (AIV-P1-006). */
    async listJobsForDesk(ctx: WorkspaceContext): Promise<DeskJob[]> {
      await authorize(ctx, 'job.list');
      const store = storeFor(ctx.tx);
      const list = await store.listJobs(ctx.workspaceId);
      const states = new Map((await store.rubricStates(ctx.workspaceId)).map((s) => [s.jobId, s]));
      return list.map((job) => {
        const state = states.get(job.id);
        const rubric = { approved: state?.approved ?? false, latest: state?.latest ?? null };
        // shortcut: assessed and coverage come from assessment (AIV-P1-031), open evidence requests from evidence
        // requests (AIV-P1-037) and pack readiness from decision packs (AIV-P2-010); until then not yet available.
        return {
          ...job,
          rubric,
          assessed: rubric.approved ? null : 0,
          coveragePercent: null,
          nextAction: nextAction(rubric, { packReady: null, openEvidenceRequests: null }),
        };
      });
    },

    /** Every job page's header (AIV-P1-011); null as `getJob`. */
    async getJobHeader(ctx: WorkspaceContext, jobId: string): Promise<JobHeader | null> {
      const store = storeFor(ctx.tx);
      const job = await store.getJob(ctx.workspaceId, jobId);
      if (!job) return null;
      await authorize(ctx, 'job.view', resourceOf(job));
      const approved = await store.approvedVersion(ctx.workspaceId, jobId);
      const latest = await store.latestVersion(ctx.workspaceId, jobId);
      // shortcut: assessed comes from assessment (AIV-P1-031) as in listJobsForDesk; interviews (AIV-P2-001) and the
      // decision pack (AIV-P2-010) report nothing yet, so the header shows them as not started.
      return { job, approved, latest, assessed: approved ? null : 0 };
    },

    /** The rubric page (AIV-P1-012): every version with its competencies, newest first; null as `getJob`. */
    async listRubricVersions(ctx: WorkspaceContext, jobId: string): Promise<Rubric[] | null> {
      const store = storeFor(ctx.tx);
      const job = await store.getJob(ctx.workspaceId, jobId);
      if (!job) return null;
      await authorize(ctx, 'job.view', resourceOf(job));
      // shortcut: one competency read per version; a job has a handful of versions. Join them if that grows.
      const versions = await store.listVersions(ctx.workspaceId, jobId);
      return Promise.all(
        versions.map(async (v) => ({ ...v, competencies: await store.competencies(ctx.workspaceId, v.id) })),
      );
    },

    /** What assessment reads: the job's approved version, never a draft; null when none is approved yet. */
    async getApprovedRubric(ctx: WorkspaceContext, jobId: string): Promise<Rubric | null> {
      const store = storeFor(ctx.tx);
      const job = await store.getJob(ctx.workspaceId, jobId);
      if (!job) return null;
      await authorize(ctx, 'job.view', resourceOf(job));
      const version = await store.approvedVersion(ctx.workspaceId, jobId);
      return version && { ...version, competencies: await store.competencies(ctx.workspaceId, version.id) };
    },

    /**
     * Saves the job's rubric: edits the version not yet approved in place (back to draft), or, when the latest is
     * approved or there is none, starts the next version. The approved version stays in force meanwhile.
     */
    async saveRubric(ctx: WorkspaceContext, jobId: string, input: SaveRubricInput): Promise<RubricVersion> {
      // Locks the job row, so two saves cannot both take the same next version number.
      const job = await visibleJob(ctx, jobId, 'rubric.edit', true);
      assertValidCompetencies(input.competencies);
      const store = storeFor(ctx.tx);
      const latest = await store.latestVersion(ctx.workspaceId, job.id);
      // One open version per job (rubric_version_one_open_idx): editing resumes it.
      const open = latest && editsInPlace(latest) ? latest : null;
      const approved = await store.approvedVersion(ctx.workspaceId, job.id);
      // Optimistic concurrency: the job row lock orders saves, and an editor's copy must still be the latest.
      const expected = open ?? approved;
      if (input.base && (expected?.id !== input.base.versionId || expected.revision !== input.base.revision))
        throw new JobError('stale');
      const content = {
        successStatement: input.successStatement.trim(),
        changeNote:
          input.changeNote?.trim() ||
          (approved && describeChanges(await store.competencies(ctx.workspaceId, approved.id), input.competencies)) ||
          null,
        status: 'draft' as const,
      };
      if (open) {
        const version = { ...open, ...content, revision: open.revision + 1 };
        await store.replaceDraft(version, input.competencies);
        return version;
      }
      const version: RubricVersion = {
        id: newId(),
        workspaceId: ctx.workspaceId,
        jobId: job.id,
        version: (latest?.version ?? 0) + 1,
        ...content,
        createdBy: ctx.userId,
        createdAt: now(),
        approvedBy: null,
        approvedAt: null,
        revision: 0,
      };
      await store.insertVersion(version, input.competencies);
      return version;
    },

    /**
     * Sends a draft for the hiring owner's approval (AIV-P1-013). The approved version stays in force, so assessment
     * and ranking do not change until this one is approved. Audited.
     */
    async submitRubric(ctx: WorkspaceContext, versionId: string): Promise<void> {
      const store = storeFor(ctx.tx);
      const found = await store.getVersion(ctx.workspaceId, versionId);
      if (!found) throw new JobError('not_found');
      await visibleJob(ctx, found.jobId, 'rubric.edit', true);
      const version = await store.getVersion(ctx.workspaceId, versionId);
      if (!version) throw new JobError('not_found');
      assertTransition(version.status, 'awaiting_approval');
      await store.setStatus(ctx.workspaceId, versionId, 'awaiting_approval');
      await audit(ctx, {
        action: 'rubric.submitted',
        subject: { type: 'rubric_version', id: versionId },
        before: { status: version.status },
        after: { status: 'awaiting_approval', jobId: version.jobId, version: version.version },
      });
    },

    /** The hiring owner approves a version awaiting approval; the previously approved version becomes superseded. */
    async approveRubric(ctx: WorkspaceContext, versionId: string): Promise<void> {
      const store = storeFor(ctx.tx);
      const found = await store.getVersion(ctx.workspaceId, versionId);
      if (!found) throw new JobError('not_found');
      // Locks the job row, so two approvals of one job run one after the other.
      const job = await visibleJob(ctx, found.jobId, 'rubric.approve', true);
      const version = await store.getVersion(ctx.workspaceId, versionId);
      if (!version) throw new JobError('not_found');
      assertTransition(version.status, 'approved');
      const previous = await store.approvedVersion(ctx.workspaceId, job.id);
      // Superseded first: the partial unique index allows one approved version per job at any moment.
      if (previous) await store.setStatus(ctx.workspaceId, previous.id, 'superseded');
      await store.setStatus(ctx.workspaceId, versionId, 'approved', { by: ctx.userId, at: now() });
      // A published job's listing follows the approved version at once; a draft never reaches it.
      if (job.published && job.publicDescriptor && job.publishedAt)
        await writePublicJob(ctx, job, versionId, job.publicDescriptor, job.publishedAt);
      // shortcut: RubricApproved.v1 is not published; write it to the outbox here, in ctx.tx, once AIV-P0-014 lands.
      await audit(ctx, {
        action: 'rubric.approved',
        subject: { type: 'rubric_version', id: versionId },
        before: { status: version.status, approvedVersionId: previous?.id ?? null },
        after: { status: 'approved', jobId: job.id, version: version.version },
      });
    },

    /**
     * What candidates would see, for the publish preview: the job with its approved rubric's competencies, through the
     * allow-list. Null when no version is approved yet. `job.publish`, since only those who can publish preview it.
     */
    async getPublicListing(ctx: WorkspaceContext, jobId: string): Promise<PublicListing | null> {
      const job = await visibleJob(ctx, jobId, 'job.publish');
      const store = storeFor(ctx.tx);
      const version = await store.approvedVersion(ctx.workspaceId, job.id);
      return version && toPublicListing(job, await store.competencies(ctx.workspaceId, version.id));
    },

    /** Lists the job on the candidate site. Needs an approved rubric. Publishing again updates the descriptor. Audited. */
    async publishJob(ctx: WorkspaceContext, jobId: string, input: PublishJobInput): Promise<void> {
      // Locks the job row, so a concurrent approval or unpublish runs before or after, never between.
      const job = await visibleJob(ctx, jobId, 'job.publish', true);
      const publicDescriptor = validPublicDescriptor(input.publicDescriptor);
      // The descriptor is shown to anyone, so it must not name the client (AGENTS.md 1.9); listClients needs
      // client.manage, which the same roles hold as job.publish.
      // shortcut: catches the literal name only, ignoring case (not "FalconPay" or an Arabic form); upgrade when clients
      // get aliases or Arabic names.
      const client = job.clientId && (await listClients(ctx)).find((c) => c.id === job.clientId);
      if (client && publicDescriptor.toLowerCase().includes(client.name.trim().toLowerCase()))
        throw new JobError('public_descriptor');
      const store = storeFor(ctx.tx);
      const approved = await store.approvedVersion(ctx.workspaceId, job.id);
      if (!approved) throw new JobError('rubric_not_approved');
      const publishedAt = now();
      await store.setPublication(ctx.workspaceId, job.id, { published: true, publicDescriptor, publishedAt });
      await writePublicJob(ctx, job, approved.id, publicDescriptor, publishedAt);
      // shortcut: JobPublished.v1 is not published; write it to the outbox here, in ctx.tx, once AIV-P0-014 lands.
      await audit(ctx, {
        action: 'job.published',
        subject: { type: 'job', id: job.id },
        before: { published: job.published, publicDescriptor: job.publicDescriptor },
        after: { published: true, publicDescriptor },
      });
    },

    /** Takes the job off the candidate site. Applications already received stay where they are. Audited. */
    async unpublishJob(ctx: WorkspaceContext, jobId: string): Promise<void> {
      const job = await visibleJob(ctx, jobId, 'job.publish', true);
      if (!job.published) return;
      await storeFor(ctx.tx).setPublication(ctx.workspaceId, job.id, {
        published: false,
        publicDescriptor: job.publicDescriptor,
        publishedAt: job.publishedAt,
      });
      await storeFor(ctx.tx).closePublicJob(ctx.workspaceId, job.id);
      // shortcut: JobUnpublished.v1 is not published; write it to the outbox here, in ctx.tx, once AIV-P0-014 lands.
      await audit(ctx, {
        action: 'job.unpublished',
        subject: { type: 'job', id: job.id },
        before: { published: true },
        after: { published: false },
      });
    },

    /** The demo seed's reset (AIV-P1-065): admins; refuses unless the workspace and every job in it is synthetic. */
    async purgeSyntheticJobs(ctx: WorkspaceContext): Promise<void> {
      await authorize(ctx, 'workspace.settings');
      if (!(await isSyntheticWorkspace(ctx))) throw new JobError('not_synthetic');
      if (!(await storeFor(ctx.tx).deleteSyntheticJobs(ctx.workspaceId))) throw new JobError('not_synthetic');
    },

    /** The workspace's public listings leave (or return to) the candidate site; `tx` is withWorkspace(<it>)'s. */
    pausePublicListings(tx: Tx, workspaceId: string, paused: boolean): Promise<void> {
      return storeFor(tx).pausePublicJobs(workspaceId, paused);
    },
  };
}
