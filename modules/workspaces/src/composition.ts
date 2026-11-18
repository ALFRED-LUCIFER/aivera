// Builds the workspaces module for an app (ADR-002: only apps import this).
// Not the @aivera/db index: it also exports the migrator, whose module paths do not resolve inside a Next.js bundle.
import type { AuditContract } from '@aivera/audit';
import type { Db, Tx } from '@aivera/db/client';
import { uuidv7 } from '@aivera/db/uuidv7';
import { withWorkspace } from '@aivera/db/with-workspace';
import { contextUseCases, type ContextPorts, type JobGrants } from './application/context.ts';
import { workspacesUseCases } from './application/workspaces.ts';
import type { WorkspacesContract } from './contracts/index.ts';
import { activeWorkspaceStore, workspaceStore } from './infrastructure/repository.ts';

// shortcut: no job-grant tables yet, so hiring owners and interviewers are refused every job-scoped action (fails
// closed); AIV-P0-906 replaces this with the workspaces.job_grant lookup.
const noJobGrants: JobGrants<Tx> = { covers: async () => false };

/** `audit` records role changes in the same transaction (AIV-P0-013). */
export function createWorkspaces(db: Db, audit: AuditContract): WorkspacesContract {
  const inWorkspace: ContextPorts<Tx>['inWorkspace'] = (workspaceId, work) =>
    withWorkspace(db, workspaceId, (tx) => work(workspaceStore(tx, audit), tx));
  return {
    ...workspacesUseCases({ inWorkspace, newId: () => uuidv7() }),
    ...contextUseCases({
      inWorkspace,
      grants: noJobGrants,
      active: {
        get: (userId) => db.transaction((tx) => activeWorkspaceStore(tx).get(userId)),
        set: (userId, workspaceId) => db.transaction((tx) => activeWorkspaceStore(tx).set(userId, workspaceId)),
      },
    }),
  };
}
