// Builds the workspaces module for an app (ADR-002: only apps import this).
// Not the @aivera/db index: it also exports the migrator, whose module paths do not resolve inside a Next.js bundle.
import type { AuditContract } from '@aivera/audit';
import type { Db, Tx } from '@aivera/db/client';
import { uuidv7 } from '@aivera/db/uuidv7';
import { withWorkspace } from '@aivera/db/with-workspace';
import { clientsUseCases } from './application/clients.ts';
import { contextUseCases, type ContextPorts, type JobGrants } from './application/context.ts';
import { workspacesUseCases } from './application/workspaces.ts';
import type { WorkspacesContract } from './contracts/index.ts';
import { grantsCover } from './domain/permissions.ts';
import { activeWorkspaceStore, workspaceStore } from './infrastructure/repository.ts';

const newId = () => uuidv7();

/** `audit` records role changes, client and grant changes in the same transaction (AIV-P0-013). */
export function createWorkspaces(db: Db, audit: AuditContract): WorkspacesContract {
  const inWorkspace: ContextPorts<Tx>['inWorkspace'] = (workspaceId, work) =>
    withWorkspace(db, workspaceId, (tx) => work(workspaceStore(tx, audit), tx));
  const storeFor = (tx: Tx) => workspaceStore(tx, audit);
  // Read in the request's own transaction, so a revoked grant stops working on the next request.
  const grants: JobGrants<Tx> = {
    covers: async (ctx, resource) =>
      grantsCover(await storeFor(ctx.tx).listGrants(ctx.workspaceId, ctx.userId), resource),
  };
  const context = contextUseCases({
    inWorkspace,
    storeFor,
    grants,
    active: {
      get: (userId) => db.transaction((tx) => activeWorkspaceStore(tx).get(userId)),
      set: (userId, workspaceId) => db.transaction((tx) => activeWorkspaceStore(tx).set(userId, workspaceId)),
    },
  });
  return {
    ...workspacesUseCases({ inWorkspace, newId }),
    ...context,
    ...clientsUseCases({ storeFor, newId, authorize: context.authorize }),
  };
}
