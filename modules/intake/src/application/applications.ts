import type { Tx } from '@credalent/db';
import type { FindOrCreatePersonInput } from '@credalent/candidates';
import { ForbiddenError, type Action, type JobResource, type WorkspaceContext } from '@credalent/workspaces';
import { IntakeError, type Application, type ApplicationSource, type Source } from '../domain/application.ts';

/** The store over one workspace-scoped transaction. Every method filters by `workspaceId`. */
export type IntakeStore = {
  /** Inserts the application, or returns the one this person already has for this job (unique per person and job). */
  insertOrGetApplication(application: Application): Promise<Application>;
  insertSource(source: ApplicationSource): Promise<void>;
  findApplication(workspaceId: string, applicationId: string): Promise<Application | null>;
  /** An arrival with its application's person, or null when the workspace has no such source. */
  findSource(
    workspaceId: string,
    sourceId: string,
  ): Promise<{ personId: string; links: string[]; githubLogin: string | null } | null>;
};

export type Ports = {
  storeFor(tx: Tx): IntakeStore;
  /** Writes `ApplicationReceived.v1` to the outbox in `tx`, so it commits only with the source (AIV-P0-014). */
  publishApplicationReceived(tx: Tx, source: ApplicationSource): Promise<void>;
  authorize(ctx: WorkspaceContext, action: Action, resource?: JobResource): Promise<void>;
  /** The candidates contract's `findOrCreatePerson`. */
  findOrCreatePerson(ctx: WorkspaceContext, input: FindOrCreatePersonInput): Promise<{ personId: string }>;
  /** The job and its client, or null when the context cannot see it (the jobs contract's `getJob`, under RLS). */
  jobResource(ctx: WorkspaceContext, jobId: string): Promise<JobResource | null>;
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

export type ReceiveApplicationResult = { applicationId: string; personId: string; sourceId: string; created: boolean };

export function applicationUseCases({
  storeFor,
  publishApplicationReceived,
  authorize,
  findOrCreatePerson,
  jobResource,
  newId,
  now,
}: Ports) {
  return {
    async receiveApplication(ctx: WorkspaceContext, input: ReceiveApplicationInput): Promise<ReceiveApplicationResult> {
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
      };
      await store.insertSource(source);
      // Every arrival can bring new files, so every arrival triggers ingestion.
      await publishApplicationReceived(ctx.tx, source);
      return { applicationId: application.id, personId, sourceId: source.id, created: application.id === id };
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
      };
      await store.insertSource(source);
      await publishApplicationReceived(ctx.tx, source);
      return { sourceId: source.id };
    },
  };
}
