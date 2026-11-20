// Builds the jobs module for an app (ADR-002: only apps import this).
import type { AiClient } from '@aivera/ai';
import type { AuditContract } from '@aivera/audit';
import type { Db, Tx } from '@aivera/db/client';
import { enqueue } from '@aivera/db/outbox';
import { uuidv7 } from '@aivera/db/uuidv7';
import { withWorkspace } from '@aivera/db/with-workspace';
import type { WorkspacesContract } from '@aivera/workspaces';
import { eq, sql, type SQL } from 'drizzle-orm';
import { domainDetection } from './application/detect-domain.ts';
import { competencyDrafting } from './application/draft-competencies.ts';
import { jobsUseCases } from './application/jobs.ts';
import {
  JobPublishedV1,
  JobUnpublishedV1,
  RubricApprovedV1,
  type CompetencyDrafting,
  type DomainDetecting,
  type JobCounts,
  type JobsContract,
  type PublicJobsContract,
} from './contracts/index.ts';
import { readCatalogueVersion } from './infrastructure/catalogue.ts';
import { findBySlug, listOpen } from './infrastructure/public-reads.ts';
import { countJobs, jobStore } from './infrastructure/repository.ts';
import { catalogueVersion, outbox } from './infrastructure/schema.ts';

/**
 * Every call runs in the request's `withWorkspace` transaction (`ctx.tx`), so no pool is needed here.
 * `now` is the injected clock (AGENTS.md 3.9); tests pass a fixed one.
 */
export function createJobs(
  workspaces: Pick<WorkspacesContract, 'authorize' | 'listClients' | 'getWorkspace' | 'setJobOwner'>,
  audit: Pick<AuditContract, 'record'>,
  now: () => Date = () => new Date(),
): JobsContract {
  return jobsUseCases({
    storeFor: jobStore,
    authorize: (ctx, action, resource) => workspaces.authorize(ctx, action, resource),
    listClients: (ctx) => workspaces.listClients(ctx),
    setJobOwner: (ctx, input) => workspaces.setJobOwner(ctx, input),
    isSyntheticWorkspace: async (ctx) => (await workspaces.getWorkspace(ctx))?.synthetic === true,
    publishRubricApproved: (ctx, { occurredAt, ...payload }) =>
      enqueue(ctx.tx, outbox, RubricApprovedV1, {
        workspaceId: ctx.workspaceId,
        payload,
        dedupeKey: `rubric-approved:${payload.rubricVersionId}`,
        occurredAt,
      }),
    // A job may be published and unpublished many times: each change is its own event.
    publishListingChange: (ctx, { listed, jobId, occurredAt }) =>
      enqueue(ctx.tx, outbox, listed ? JobPublishedV1 : JobUnpublishedV1, {
        workspaceId: ctx.workspaceId,
        payload: { jobId },
        dedupeKey: `${listed ? 'job-published' : 'job-unpublished'}:${jobId}:${occurredAt.toISOString()}`,
        occurredAt,
      }),
    audit: (ctx, entry) =>
      audit.record({ tx: ctx.tx, workspaceId: ctx.workspaceId, actor: { type: 'user', id: ctx.userId } }, entry),
    newId: () => uuidv7(),
    now,
  });
}

/**
 * The candidate site's reads on the app's pool, with no workspace. Each call is its own transaction switched to
 * aivera_public (SET LOCAL ROLE, undone at commit or rollback), which can read the public columns of jobs.public_job
 * and nothing else, so a wrong query in a public read is refused. It does not stop injected SQL (RESET ROLE); all SQL
 * here is parameterised (AGENTS.md 3.10).
 */
export function createPublicJobs(db: Db): PublicJobsContract {
  const asPublic = <T>(read: (tx: Tx) => Promise<T>) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`set local role aivera_public`);
      return read(tx);
    });
  return { listPublicJobs: () => asPublic(listOpen), findPublicJob: (slug) => asPublic((tx) => findBySlug(tx, slug)) };
}

/** The operator console's job count (ADR-012 point 6), each call in the workspace's own scoped transaction. */
export function createJobCounts(db: Db): JobCounts {
  return { countJobs: (workspaceId) => withWorkspace(db, workspaceId, (tx) => countJobs(tx, workspaceId)) };
}

/**
 * The catalogue in the database (ADR-013 point 15) on the app's pool, with no workspace: the tables are platform tables.
 * Each read is one read-only snapshot. Not wired to callers yet; readers switch in AIV-P2-044.
 */
export function createCatalogueReads(db: Db) {
  const read = (where: SQL) =>
    db.transaction((tx) => readCatalogueVersion(tx, where), {
      isolationLevel: 'repeatable read',
      accessMode: 'read only',
    });
  return {
    /** The latest published version. */
    getPublishedCatalogue: () => read(eq(catalogueVersion.status, 'published')),
    /** Version `n`, draft or published. */
    getCatalogueVersion: (n: number) => read(eq(catalogueVersion.version, n)),
  };
}

/** "Draft competencies" on the app's AI client (`createAiClient` with the workspaces budget store). */
export const createCompetencyDrafting = (ai: Pick<AiClient, 'generateStructured'>): CompetencyDrafting =>
  competencyDrafting(ai);

/** "Detect the job's industry" on the app's AI client, as `createCompetencyDrafting`. */
export const createDomainDetection = (ai: Pick<AiClient, 'generateStructured'>): DomainDetecting => domainDetection(ai);
