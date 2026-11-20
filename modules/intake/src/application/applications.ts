import type { Tx } from '@credalent/db';
import type { FindOrCreatePersonInput } from '@credalent/candidates';
import type { Action, WorkspaceContext } from '@credalent/workspaces';
import { IntakeError, type Application, type ApplicationSource, type Source } from '../domain/application.ts';

/** The store over one workspace-scoped transaction. Every method filters by `workspaceId`. */
export type IntakeStore = {
  /** Inserts the application, or returns the one this person already has for this job (unique per person and job). */
  insertOrGetApplication(application: Application): Promise<Application>;
  insertSource(source: ApplicationSource): Promise<void>;
};

export type Ports = {
  storeFor(tx: Tx): IntakeStore;
  /** Writes `ApplicationReceived.v1` to the outbox in `tx`, so it commits only with the source (AIV-P0-014). */
  publishApplicationReceived(tx: Tx, source: ApplicationSource): Promise<void>;
  authorize(ctx: WorkspaceContext, action: Action): Promise<void>;
  /** The candidates contract's `findOrCreatePerson`. */
  findOrCreatePerson(ctx: WorkspaceContext, input: FindOrCreatePersonInput): Promise<{ personId: string }>;
  /** Whether the job exists in the context's workspace (the jobs contract's `getJob`, filtered and under RLS). */
  jobExists(ctx: WorkspaceContext, jobId: string): Promise<boolean>;
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
};

export type ReceiveApplicationResult = { applicationId: string; personId: string; sourceId: string; created: boolean };

export function applicationUseCases({
  storeFor,
  publishApplicationReceived,
  authorize,
  findOrCreatePerson,
  jobExists,
  newId,
  now,
}: Ports) {
  return {
    async receiveApplication(ctx: WorkspaceContext, input: ReceiveApplicationInput): Promise<ReceiveApplicationResult> {
      await authorize(ctx, 'candidate.create');
      // Checked before the person is found or created, so a refused application writes nothing.
      if (!(await jobExists(ctx, input.jobId))) throw new IntakeError('job_not_found');
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
      };
      await store.insertSource(source);
      // Every arrival can bring new files, so every arrival triggers ingestion.
      await publishApplicationReceived(ctx.tx, source);
      return { applicationId: application.id, personId, sourceId: source.id, created: application.id === id };
    },
  };
}
