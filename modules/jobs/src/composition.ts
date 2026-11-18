// Builds the jobs module for an app (ADR-002: only apps import this).
import type { AuditContract } from '@aivera/audit';
import type { Db, Tx } from '@aivera/db/client';
import { uuidv7 } from '@aivera/db/uuidv7';
import type { WorkspacesContract } from '@aivera/workspaces';
import { sql } from 'drizzle-orm';
import { jobsUseCases } from './application/jobs.ts';
import type { JobsContract, PublicJobsContract } from './contracts/index.ts';
import { findBySlug, listOpen } from './infrastructure/public-reads.ts';
import { jobStore } from './infrastructure/repository.ts';

/**
 * Every call runs in the request's `withWorkspace` transaction (`ctx.tx`), so no pool is needed here.
 * `now` is the injected clock (AGENTS.md 3.9); tests pass a fixed one.
 */
export function createJobs(
  workspaces: Pick<WorkspacesContract, 'authorize' | 'listClients'>,
  audit: Pick<AuditContract, 'record'>,
  now: () => Date = () => new Date(),
): JobsContract {
  return jobsUseCases({
    storeFor: jobStore,
    authorize: (ctx, action, resource) => workspaces.authorize(ctx, action, resource),
    listClients: (ctx) => workspaces.listClients(ctx),
    audit: (ctx, entry) =>
      audit.record({ tx: ctx.tx, workspaceId: ctx.workspaceId, actor: { type: 'user', id: ctx.userId } }, entry),
    newId: () => uuidv7(),
    now,
  });
}

/**
 * The candidate site's reads on the app's pool, with no workspace. Each call is its own transaction switched to
 * aivera_public (SET LOCAL ROLE, undone at commit), which can read the public columns of jobs.public_job and nothing
 * else, so a bug in a public read cannot reach another table.
 */
export function createPublicJobs(db: Db): PublicJobsContract {
  const asPublic = <T>(read: (tx: Tx) => Promise<T>) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`set local role aivera_public`);
      return read(tx);
    });
  return { listPublicJobs: () => asPublic(listOpen), findPublicJob: (slug) => asPublic((tx) => findBySlug(tx, slug)) };
}
