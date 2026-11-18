// Builds the jobs module for an app (ADR-002: only apps import this).
import type { AuditContract } from '@aivera/audit';
import { uuidv7 } from '@aivera/db/uuidv7';
import type { WorkspacesContract } from '@aivera/workspaces';
import { jobsUseCases } from './application/jobs.ts';
import type { JobsContract } from './contracts/index.ts';
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
