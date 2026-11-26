import type { Tx } from '@credalent/db';
import type { FindOrCreatePersonInput } from '@credalent/candidates';
import { ForbiddenError, type Action, type JobResource, type WorkspaceContext } from '@credalent/workspaces';
import { z } from 'zod';
import {
  CHOICE_REASON_MAX,
  IntakeError,
  type Application,
  type ApplicationSource,
  type ImportBatch,
  type Source,
  type Stage,
  wordingVersion,
} from '../domain/application.ts';

/** The store over one workspace-scoped transaction. Every method filters by `workspaceId`. */
export type IntakeStore = {
  /** Inserts the application, or returns the one this person already has for this job (unique per person and job). */
  insertOrGetApplication(application: Application): Promise<Application>;
  insertSource(source: ApplicationSource): Promise<void>;
  insertBatch(batch: ImportBatch): Promise<void>;
  /** The batch of any source of the application (links added later inherit it), or null when none has one. */
  batchOfApplication(workspaceId: string, applicationId: string): Promise<string | null>;
  findApplication(workspaceId: string, applicationId: string): Promise<Application | null>;
  /** The person's application for the job, or null (one per person and job). */
  findForPersonAndJob(workspaceId: string, personId: string, jobId: string): Promise<Application | null>;
  /** Moves the stage only while it is still `from`, so two concurrent moves cannot both apply. */
  moveStage(workspaceId: string, applicationId: string, from: Stage, to: Stage): Promise<boolean>;
  /** An arrival with its application's person, or null when the workspace has no such source. */
  findSource(
    workspaceId: string,
    sourceId: string,
  ): Promise<{
    personId: string;
    links: string[];
    githubLogin: string | null;
    fileIds: string[];
    batchId: string | null;
  } | null>;
  /** The job's applications, newest first, each with the source of its first arrival. */
  listForJob(
    workspaceId: string,
    jobId: string,
  ): Promise<{ applicationId: string; personId: string; stage: Stage; receivedAt: Date; source: Source }[]>;
  /** How many applications the job has, from every source. */
  countForJob(workspaceId: string, jobId: string): Promise<number>;
  /** Deletes every application, source and batch of the workspace. */
  deleteAll(workspaceId: string): Promise<void>;
};

/** One person moved to `interview` with their Round 1 interview, as audited (`application.stage_changed`). */
export type StageChange = {
  applicationId: string;
  jobId: string;
  from: Stage;
  to: Stage;
  interviewId: string;
  reason: string;
};

/**
 * What choosing for interview calls (AIV-P1-114). Apps wire them, so intake needs neither the interviews nor the
 * assessment package; without them `chooseForInterview` throws.
 */
export type InterviewPorts = {
  /** The interviews contract's `createInterview`, in `ctx.tx`; it authorises `interview.schedule` on the job itself. */
  createInterview(
    ctx: WorkspaceContext,
    input: { applicationId: string; round: 'structured_screen'; interviewerUserId: string; competencyIds: string[] },
  ): Promise<{ interviewId: string }>;
  /** The competencies to investigate: the gaps of the candidate's latest assessment for the job; none without one. */
  interviewGaps(ctx: WorkspaceContext, personId: string, jobId: string): Promise<string[]>;
};

export type Ports = {
  storeFor(tx: Tx): IntakeStore;
  /** Writes `ApplicationReceived.v1` to the outbox in `tx`, so it commits only with the source (AIV-P0-014). */
  publishApplicationReceived(tx: Tx, source: ApplicationSource): Promise<void>;
  authorize(ctx: WorkspaceContext, action: Action, resource?: JobResource): Promise<void>;
  /** Appends `intake.batch_confirmed` to the audit log in `ctx.tx` (the audit module's `record`). */
  auditBatchConfirmed(ctx: WorkspaceContext, batch: ImportBatch): Promise<void>;
  /** Appends `application.stage_changed` to the audit log in `ctx.tx`, with the reason as its note. */
  auditStageChanged(ctx: WorkspaceContext, change: StageChange): Promise<void>;
  interviews?: InterviewPorts;
  /** The candidates contract's `findOrCreatePerson`. */
  findOrCreatePerson(ctx: WorkspaceContext, input: FindOrCreatePersonInput): Promise<{ personId: string }>;
  /**
   * The candidates composition's `displayNamesInWorkspace`: unauthorised, so only `listApplicationsForJob` calls it,
   * after it authorised the job, with that job's applicants alone.
   */
  displayNames(tx: Tx, workspaceId: string, personIds: string[]): Promise<{ id: string; displayName: string }[]>;
  /** The job and its client, or null when the context cannot see it (the jobs contract's `getJob`, under RLS). */
  jobResource(ctx: WorkspaceContext, jobId: string): Promise<JobResource | null>;
  isSyntheticWorkspace(ctx: WorkspaceContext): Promise<boolean>;
  newId(): string;
  now(): Date;
};

/** One arrival. Its caller (an intake channel, AIV-P1-019) validates the shape with zod (AGENTS.md 3.7). */
export type ReceiveApplicationInput = {
  jobId: string;
  /** Who applied: their name and identifiers (email, phone, CV hash), as `findOrCreatePerson` takes them. */
  person: FindOrCreatePersonInput;
  source: Source;
  fileIds?: string[];
  links?: string[];
  /** The GitHub login the candidate typed, if any; evidence reads their repository links by it (AIV-P1-076). */
  githubLogin?: string;
};

/**
 * The CVs of one save of "Add applicants": added together, under one confirmation. `rightToProcessConfirmed` is the
 * recruiter's tick; the command refuses anything else (AIV-P1-104).
 */
export type ReceiveBatchInput = {
  jobId: string;
  rightToProcessConfirmed: true;
  /** The app's message key for the wording shown, e.g. `import.rightToProcess.v1`; its version is stored. */
  wordingKey: string;
  arrivals: Omit<ReceiveApplicationInput, 'jobId'>[];
};

/** Validated in the use case whatever the caller checked (AGENTS.md 3.7); the reason is checked after trimming. */
const chooseForInterviewInputSchema = z.strictObject({
  jobId: z.uuid(),
  applicationIds: z.array(z.uuid()).min(1).max(50),
  reason: z.string(),
});
export type ChooseForInterviewInput = z.input<typeof chooseForInterviewInputSchema>;

/** Who was chosen, each with their new interview, and who was skipped because they were already chosen. */
export type ChooseForInterviewResult = { chosen: { applicationId: string; interviewId: string }[]; skipped: string[] };

export type ReceiveApplicationResult = { applicationId: string; personId: string; sourceId: string; created: boolean };

/** One row of a job's applicant list (AIV-P1-086). `displayName` is null only if the person record is gone. */
export type ApplicationListItem = {
  applicationId: string;
  /** The opaque person id: the ranked table (AIV-P1-034) joins it to the assessment ranking's `candidateId`. */
  personId: string;
  displayName: string | null;
  stage: Stage;
  receivedAt: Date;
  source: Source;
};

export function applicationUseCases({
  storeFor,
  publishApplicationReceived,
  authorize,
  auditBatchConfirmed,
  auditStageChanged,
  interviews,
  findOrCreatePerson,
  displayNames,
  jobResource,
  isSyntheticWorkspace,
  newId,
  now,
}: Ports) {
  async function receive(
    ctx: WorkspaceContext,
    input: ReceiveApplicationInput,
    batchId: string | null,
  ): Promise<ReceiveApplicationResult> {
    // shortcut: every arrival of a batch re-runs this authorize and a getJob read (200 CVs = 200 job reads in one transaction); hoist both into receiveBatch when a batch gets slow.
    await authorize(ctx, 'candidate.create');
    // Checked before the person is found or created, so a refused application writes nothing.
    if (!(await jobResource(ctx, input.jobId))) throw new IntakeError('job_not_found');
    const { personId } = await findOrCreatePerson(ctx, input.person);
    const store = storeFor(ctx.tx);
    const receivedAt = now();
    const id = newId();
    const application = await store.insertOrGetApplication({
      id,
      workspaceId: ctx.workspaceId,
      personId,
      jobId: input.jobId,
      stage: 'new',
      receivedAt,
      submittedToClientAt: null,
    });
    const source: ApplicationSource = {
      id: newId(),
      workspaceId: ctx.workspaceId,
      applicationId: application.id,
      source: input.source,
      receivedAt,
      fileIds: input.fileIds ?? [],
      links: input.links ?? [],
      githubLogin: input.githubLogin ?? null,
      batchId,
    };
    await store.insertSource(source);
    // Every arrival can bring new files, so every arrival triggers ingestion.
    await publishApplicationReceived(ctx.tx, source);
    return { applicationId: application.id, personId, sourceId: source.id, created: application.id === id };
  }

  return {
    // shortcut: an arrival with no batch is stored but never read by the worker; candidate-site applications carry the
    // applicant's own consent and need their own exemption (AIV-P3-008).
    receiveApplication: (ctx: WorkspaceContext, input: ReceiveApplicationInput) => receive(ctx, input, null),

    async receiveBatch(
      ctx: WorkspaceContext,
      input: ReceiveBatchInput,
    ): Promise<{ batchId: string; applications: ReceiveApplicationResult[] }> {
      // Checked first, at runtime too: the type is no control for a caller from the browser (AGENTS.md 3.7).
      if ((input.rightToProcessConfirmed as unknown) !== true) throw new IntakeError('confirmation_required');
      const version = wordingVersion(input.wordingKey);
      if (!version) throw new IntakeError('invalid_wording');
      await authorize(ctx, 'candidate.create');
      if (!(await jobResource(ctx, input.jobId))) throw new IntakeError('job_not_found');
      const batch: ImportBatch = {
        id: newId(),
        workspaceId: ctx.workspaceId,
        jobId: input.jobId,
        confirmedBy: ctx.userId,
        confirmedAt: now(),
        wordingKey: input.wordingKey,
        wordingVersion: version,
        cvs: input.arrivals.length,
      };
      await storeFor(ctx.tx).insertBatch(batch);
      const applications = [];
      for (const arrival of input.arrivals) {
        applications.push(await receive(ctx, { ...arrival, jobId: input.jobId }, batch.id));
      }
      // The last statement before commit (AGENTS.md 3.6).
      await auditBatchConfirmed(ctx, batch);
      return { batchId: batch.id, applications };
    },

    // shortcut: no paging; the ranked table (AIV-P1-034) shows the first 7 in the browser, page here past ~500 applicants.
    async listApplicationsForJob(ctx: WorkspaceContext, jobId: string): Promise<ApplicationListItem[]> {
      // An ungranted job is hidden by the jobs module's row-level security: not found, so nothing says it exists.
      const job = await jobResource(ctx, jobId);
      if (!job) throw new IntakeError('job_not_found');
      await authorize(ctx, 'candidate.view', job);
      const rows = await storeFor(ctx.tx).listForJob(ctx.workspaceId, jobId);
      const people = await displayNames(ctx.tx, ctx.workspaceId, [...new Set(rows.map((r) => r.personId))]);
      const names = new Map(people.map((p) => [p.id, p.displayName]));
      return rows.map((r) => ({ ...r, displayName: names.get(r.personId) ?? null }));
    },

    async countApplications(ctx: WorkspaceContext, jobId: string): Promise<number> {
      // As listApplicationsForJob: an ungranted job is not found, so a count never says it exists.
      const job = await jobResource(ctx, jobId);
      if (!job) throw new IntakeError('job_not_found');
      await authorize(ctx, 'candidate.view', job);
      return storeFor(ctx.tx).countForJob(ctx.workspaceId, jobId);
    },

    async addLink(ctx: WorkspaceContext, applicationId: string, url: string): Promise<{ sourceId: string }> {
      const store = storeFor(ctx.tx);
      const application = await store.findApplication(ctx.workspaceId, applicationId);
      if (!application) throw new IntakeError('application_not_found');
      // The job comes from the stored application, never the request: a job the context cannot see is refused.
      const job = await jobResource(ctx, application.jobId);
      if (!job) throw new ForbiddenError();
      await authorize(ctx, 'application.add_link', job);
      const source: ApplicationSource = {
        id: newId(),
        workspaceId: ctx.workspaceId,
        applicationId,
        source: 'recruiter',
        receivedAt: now(),
        fileIds: [],
        links: [url],
        githubLogin: null,
        // shortcut: an application from before batches (AIV-P1-104) has none, so its new links are stored but not read; backfill a system batch if pilot data needs it.
        batchId: await store.batchOfApplication(ctx.workspaceId, applicationId),
      };
      await store.insertSource(source);
      await publishApplicationReceived(ctx.tx, source);
      return { sourceId: source.id };
    },

    async chooseForInterview(ctx: WorkspaceContext, raw: ChooseForInterviewInput): Promise<ChooseForInterviewResult> {
      if (!interviews) throw new Error('Choosing for interview is not wired in this app');
      const input = chooseForInterviewInputSchema.parse(raw);
      const reason = input.reason.trim();
      if (!reason || reason.length > CHOICE_REASON_MAX) throw new IntakeError('reason_required');
      // Another workspace's job, or one the member is not granted, is not found: nothing says it exists.
      const job = await jobResource(ctx, input.jobId);
      if (!job) throw new IntakeError('job_not_found');
      // Admins and recruiters on the job; hiring owners and interviewers are refused (ForbiddenError, 403).
      await authorize(ctx, 'interview.schedule', job);
      const store = storeFor(ctx.tx);
      const applications: Application[] = [];
      for (const id of new Set(input.applicationIds)) {
        const application = await store.findApplication(ctx.workspaceId, id);
        // SAFETY: every application must be this job's; one from another job refuses the whole choice, writing nothing.
        if (application?.jobId !== job.jobId) throw new IntakeError('not_on_job');
        applications.push(application);
      }
      const changes: StageChange[] = [];
      const skipped: string[] = [];
      // shortcut: a `withdrawn` application can be chosen too; no command withdraws one yet. Refuse it here when one does.
      for (const application of applications) {
        // SAFETY: someone already chosen gets no second Round 1 interview. moveStage is conditional, so a concurrent
        // choice of the same person (the only command that moves a stage) also lands here.
        if (
          application.stage === 'interview' ||
          !(await store.moveStage(ctx.workspaceId, application.id, application.stage, 'interview'))
        ) {
          skipped.push(application.id);
          continue;
        }
        const { interviewId } = await interviews.createInterview(ctx, {
          applicationId: application.id,
          round: 'structured_screen',
          interviewerUserId: ctx.userId,
          competencyIds: await interviews.interviewGaps(ctx, application.personId, job.jobId),
        });
        changes.push({
          applicationId: application.id,
          jobId: job.jobId,
          from: application.stage,
          to: 'interview',
          interviewId,
          reason,
        });
      }
      // The last statements before commit (AGENTS.md 3.6). Nothing here contacts the candidate (AGENTS.md 1.5).
      for (const change of changes) await auditStageChanged(ctx, change);
      return { chosen: changes.map(({ applicationId, interviewId }) => ({ applicationId, interviewId })), skipped };
    },

    /** The demo seed's reset (AIV-P2-001): admins; refuses unless the workspace is flagged synthetic. */
    async purgeSyntheticApplications(ctx: WorkspaceContext): Promise<void> {
      await authorize(ctx, 'workspace.settings');
      if (!(await isSyntheticWorkspace(ctx))) throw new IntakeError('not_synthetic');
      await storeFor(ctx.tx).deleteAll(ctx.workspaceId);
    },
  };
}
