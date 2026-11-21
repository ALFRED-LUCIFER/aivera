// Builds the workspaces module for an app (ADR-002: only apps import this).
// Not the @credalent/db index: it also exports the migrator, whose module paths do not resolve inside a Next.js bundle.
import type { AuditContract } from '@credalent/audit';
import type { Db, Tx } from '@credalent/db/client';
import { uuidv7 } from '@credalent/db/uuidv7';
import { withWorkspace } from '@credalent/db/with-workspace';
import { clientsUseCases } from './application/clients.ts';
import { directoryUseCases } from './application/directory.ts';
import { settingsUseCases } from './application/settings.ts';
import { invitationsUseCases } from './application/invitations.ts';
import { statusUseCases } from './application/status.ts';
import { syntheticUseCases } from './application/synthetic.ts';
import { contextUseCases, type ContextPorts, type JobGrants } from './application/context.ts';
import { workspacesUseCases } from './application/workspaces.ts';
import type { AiBudgetConsole, AiTokenBudget, WorkspaceDirectory, WorkspacesContract } from './contracts/index.ts';
import { grantsCover } from './domain/permissions.ts';
import { AI_DAILY_TOKEN_BUDGET, WorkspaceError } from './domain/workspace.ts';
import {
  activeWorkspaceStore,
  aiTokenUsageStore,
  listDirectory,
  readCreator,
  readStatus,
  readSummary,
  workspaceStore,
} from './infrastructure/repository.ts';

const newId = () => uuidv7();

/** `audit` records role, client, grant and status changes in the same transaction (AIV-P0-013); `now` is the clock (AGENTS.md 3.9). */
export function createWorkspaces(db: Db, audit: AuditContract, now: () => Date = () => new Date()): WorkspacesContract {
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
  const clients = clientsUseCases({ storeFor, newId, authorize: context.authorize });
  return {
    ...workspacesUseCases({ inWorkspace, newId }),
    ...context,
    ...clients,
    ...invitationsUseCases({
      storeFor,
      inWorkspace,
      newId,
      now,
      authorize: context.authorize,
      grantJobAccess: clients.grantJobAccess,
      revokeJobAccess: clients.revokeJobAccess,
    }),
    ...syntheticUseCases({ storeFor, authorize: context.authorize }),
    ...settingsUseCases({ storeFor, authorize: context.authorize }),
    ...statusUseCases({ inWorkspace }),
  };
}

/** The PostgreSQL store behind `@credalent/ai`'s daily token budget (AIV-P0-033): `createAiClient({ budget })`. */
export function createAiTokenBudget(db: Db): AiTokenBudget {
  return {
    spentToday: (workspaceId, day) =>
      withWorkspace(db, workspaceId, (tx) => aiTokenUsageStore(tx).spent(workspaceId, day)),
    add: (workspaceId, day, tokens) =>
      withWorkspace(db, workspaceId, (tx) => aiTokenUsageStore(tx).add(workspaceId, day, tokens)),
  };
}

/** The operator console's AI budget (AIV-P2-038, ADR-012): reads and the audited override, per workspace scope. */
export function createAiBudgetConsole(db: Db, audit: AuditContract): AiBudgetConsole {
  return {
    usage: (workspaceId, today, days) =>
      withWorkspace(db, workspaceId, (tx) => aiTokenUsageStore(tx).usage(workspaceId, today, days)),
    setDailyBudget: ({ operatorId, workspaceId, dailyBudget, reason }) =>
      withWorkspace(db, workspaceId, async (tx) => {
        const before = await aiTokenUsageStore(tx).setDailyBudget(workspaceId, dailyBudget);
        if (before === null) throw new WorkspaceError('no_workspace');
        const change = {
          action: 'ai_budget.changed',
          subject: { type: 'workspace', id: workspaceId },
          note: reason,
          before: { dailyTokenBudget: before },
          after: { dailyTokenBudget: dailyBudget ?? AI_DAILY_TOKEN_BUDGET.default },
        } as const;
        // Both logs in the change's transaction, the workspace's entry last (AGENTS.md 3.6, ADR-012 point 8).
        await audit.recordPlatform({ actorId: operatorId, ...change }, tx);
        await audit.record({ tx, workspaceId, actor: { type: 'operator', id: operatorId } }, change);
      }),
  };
}

/** The operator console's reads (ADR-012 point 6): the directory, then each workspace in its own scoped transaction. */
export function createWorkspaceDirectory(db: Db): WorkspaceDirectory {
  return directoryUseCases({
    listIds: () => db.transaction(listDirectory),
    readSummary: (workspaceId) => withWorkspace(db, workspaceId, (tx) => readSummary(tx, workspaceId)),
    readCreator: (workspaceId) => withWorkspace(db, workspaceId, (tx) => readCreator(tx, workspaceId)),
    readStatus: (workspaceId) => withWorkspace(db, workspaceId, (tx) => readStatus(tx, workspaceId)),
  });
}
