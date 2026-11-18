import type { NewEntry } from '@aivera/audit';
import type { Tx } from '@aivera/db';
import type { Action, Client, JobResource, WorkspaceContext } from '@aivera/workspaces';
import {
  assertTransition,
  assertValidCompetencies,
  assertValidPayBand,
  editsInPlace,
  JobError,
  toPublicListing,
  validPublicDescriptor,
  type Competency,
  type Job,
  type PublicListing,
  type Rubric,
  type RubricVersion,
} from '../domain/job.ts';

/**
 * The store over one workspace-scoped transaction. Every method filters by `workspaceId`, and every job read also by
 * the transaction's job scope (ADR-005 point 6), so a hiring owner's query returns only granted jobs.
 */
export type JobStore = {
  insertJob(job: Job): Promise<void>;
  getJob(workspaceId: string, jobId: string, opts?: { lock: boolean }): Promise<Job | null>;
  listJobs(workspaceId: string): Promise<Job[]>;
  /** The job's highest-numbered version, or null when it has none. */
  latestVersion(workspaceId: string, jobId: string): Promise<RubricVersion | null>;
  getVersion(workspaceId: string, versionId: string): Promise<RubricVersion | null>;
  approvedVersion(workspaceId: string, jobId: string): Promise<RubricVersion | null>;
  competencies(workspaceId: string, versionId: string): Promise<Competency[]>;
  insertVersion(version: RubricVersion, competencies: Competency[]): Promise<void>;
  /** Replaces a not-yet-approved version's statement, note and competencies, and sets it back to draft. */
  replaceDraft(version: RubricVersion, competencies: Competency[]): Promise<void>;
  /** Sets whether the job is listed on the candidate site, with its descriptor and publish time. */
  setPublication(
    workspaceId: string,
    jobId: string,
    publication: Pick<Job, 'published' | 'publicDescriptor' | 'publishedAt'>,
  ): Promise<void>;
  setStatus(
    workspaceId: string,
    versionId: string,
    status: RubricVersion['status'],
    approval?: { by: string; at: Date },
  ): Promise<void>;
};

export type Ports = {
  storeFor(tx: Tx): JobStore;
  /** The workspaces contract's `authorize`: role, and for job-scoped roles a job grant (ADR-005 point 6). */
  authorize(ctx: WorkspaceContext, action: Action, resource?: JobResource): Promise<void>;
  /** The workspaces contract's `listClients`, to check a job's client belongs to the workspace. */
  listClients(ctx: WorkspaceContext): Promise<Client[]>;
  /** The audit contract's `record` in `ctx.tx`; always the last write before commit (AGENTS.md 3.6). */
  audit(ctx: WorkspaceContext, entry: NewEntry): Promise<void>;
  newId(): string;
  now(): Date;
};

/** What the new-job form knows. Its server action validates the shape with zod (AGENTS.md 3.7). */
export type CreateJobInput = Pick<Job, 'title' | 'jobType' | 'description' | 'synthetic'> &
  Partial<Pick<Job, 'team' | 'clientId' | 'location' | 'hiringOwnerUserId' | 'payBand'>>;

/** A rubric as the recruiter saves it; competencies in display order. */
export type SaveRubricInput = { successStatement: string; changeNote?: string | null; competencies: Competency[] };

/** What the recruiter confirms in the publish preview. */
export type PublishJobInput = { publicDescriptor: string };

const resourceOf = (job: Job): JobResource => ({ jobId: job.id, clientId: job.clientId });

export function jobsUseCases({ storeFor, authorize, listClients, audit, newId, now }: Ports) {
  /** The job if the context may see it (row-level security and the repository hide the rest), else `not_found`. */
  async function visibleJob(ctx: WorkspaceContext, jobId: string, action: Action, lock = false): Promise<Job> {
    const job = await storeFor(ctx.tx).getJob(ctx.workspaceId, jobId, { lock });
    if (!job) throw new JobError('not_found');
    await authorize(ctx, action, resourceOf(job));
    return job;
  }

  return {
    async createJob(ctx: WorkspaceContext, input: CreateJobInput): Promise<Job> {
      await authorize(ctx, 'job.create');
      const title = input.title.trim();
      if (!title) throw new JobError('title');
      const payBand = input.payBand ?? null;
      assertValidPayBand(payBand);
      const clientId = input.clientId ?? null;
      // listClients checks client.manage, which allows the same roles as job.create.
      if (clientId && !(await listClients(ctx)).some((c) => c.id === clientId && !c.archivedAt))
        throw new JobError('client_not_found');
      // shortcut: the hiring owner is not checked against the workspace's members; the add-job action (AIV-P1-007,
      // apps/web addJob) accepts only active hiring owners, and approval re-checks the role through authorize.
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
      await audit(ctx, { action: 'job.created', subject: { type: 'job', id: job.id }, after: { clientId } });
      return job;
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
      const content = {
        successStatement: input.successStatement.trim(),
        changeNote: input.changeNote?.trim() || null,
        status: 'draft' as const,
      };
      if (latest && editsInPlace(latest)) {
        const version = { ...latest, ...content };
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
      };
      await store.insertVersion(version, input.competencies);
      return version;
    },

    /** Sends a draft for the hiring owner's approval. */
    async submitRubric(ctx: WorkspaceContext, versionId: string): Promise<void> {
      const store = storeFor(ctx.tx);
      const found = await store.getVersion(ctx.workspaceId, versionId);
      if (!found) throw new JobError('not_found');
      await visibleJob(ctx, found.jobId, 'rubric.edit', true);
      const version = await store.getVersion(ctx.workspaceId, versionId);
      if (!version) throw new JobError('not_found');
      assertTransition(version.status, 'awaiting_approval');
      await store.setStatus(ctx.workspaceId, versionId, 'awaiting_approval');
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
      const client = job.clientId && (await listClients(ctx)).find((c) => c.id === job.clientId);
      if (client && publicDescriptor.toLowerCase().includes(client.name.trim().toLowerCase()))
        throw new JobError('public_descriptor');
      const store = storeFor(ctx.tx);
      if (!(await store.approvedVersion(ctx.workspaceId, job.id))) throw new JobError('rubric_not_approved');
      await store.setPublication(ctx.workspaceId, job.id, { published: true, publicDescriptor, publishedAt: now() });
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
      // shortcut: JobUnpublished.v1 is not published; write it to the outbox here, in ctx.tx, once AIV-P0-014 lands.
      await audit(ctx, {
        action: 'job.unpublished',
        subject: { type: 'job', id: job.id },
        before: { published: true },
        after: { published: false },
      });
    },
  };
}
