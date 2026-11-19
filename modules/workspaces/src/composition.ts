// Builds the workspaces module for an app (ADR-002: only apps import this).
// Not the @aivera/db index: it also exports the migrator, whose module paths do not resolve inside a Next.js bundle.
import type { AuditContract } from '@aivera/audit';
import type { Db, Tx } from '@aivera/db/client';
import { uuidv7 } from '@aivera/db/uuidv7';
import { withWorkspace } from '@aivera/db/with-workspace';
import { clientsUseCases } from './application/clients.ts';
import { directoryUseCases } from './application/directory.ts';
import { syntheticUseCases } from './application/synthetic.ts';
import { contextUseCases, type ContextPorts, type JobGrants } from './application/context.ts';
import { workspacesUseCases } from './application/workspaces.ts';
import type { AiTokenBudget, WorkspaceDirectory, WorkspacesContract } from './contracts/index.ts';
import { grantsCover } from './domain/permissions.ts';
import {
  activeWorkspaceStore,
  aiTokenUsageStore,
  listDirectory,
  readSummary,
  workspaceStore,
} from './infrastructure/repository.ts';

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
    ...syntheticUseCases({ storeFor, authorize: context.authorize }),
  };
}

/** The PostgreSQL store behind `@aivera/ai`'s daily token budget (AIV-P0-033): `createAiClient({ budget })`. */
export function createAiTokenBudget(db: Db): AiTokenBudget {
  return {
    spentToday: (workspaceId, day) =>
      withWorkspace(db, workspaceId, (tx) => aiTokenUsageStore(tx).spent(workspaceId, day)),
    add: (workspaceId, day, tokens) =>
      withWorkspace(db, workspaceId, (tx) => aiTokenUsageStore(tx).add(workspaceId, day, tokens)),
  };
}

/** The operator console's reads (ADR-012 point 6): the directory, then each workspace in its own scoped transaction. */
export function createWorkspaceDirectory(db: Db): WorkspaceDirectory {
  return directoryUseCases({
    listIds: () => db.transaction(listDirectory),
    readSummary: (workspaceId) => withWorkspace(db, workspaceId, (tx) => readSummary(tx, workspaceId)),
  });
}
