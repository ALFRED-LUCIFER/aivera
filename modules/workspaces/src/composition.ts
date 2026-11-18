// Builds the workspaces module for an app (ADR-002: only apps import this).
import type { AuditContract } from '@aivera/audit';
import { uuidv7, withWorkspace, type Db } from '@aivera/db';
import { workspacesUseCases } from './application/workspaces.ts';
import type { WorkspacesContract } from './contracts/index.ts';
import { workspaceStore } from './infrastructure/repository.ts';

/** `audit` records role changes in the same transaction (AIV-P0-013). */
export function createWorkspaces(db: Db, audit: AuditContract): WorkspacesContract {
  return workspacesUseCases({
    inWorkspace: (workspaceId, work) => withWorkspace(db, workspaceId, (tx) => work(workspaceStore(tx, audit))),
    newId: () => uuidv7(),
  });
}
