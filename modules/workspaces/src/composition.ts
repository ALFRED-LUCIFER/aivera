// Builds the workspaces module for an app (ADR-002: only apps import this).
import { uuidv7, withWorkspace, type Db } from '@aivera/db';
import { workspacesUseCases } from './application/workspaces.ts';
import type { WorkspacesContract } from './contracts/index.ts';
import { workspaceStore } from './infrastructure/repository.ts';

export function createWorkspaces(db: Db): WorkspacesContract {
  return workspacesUseCases({
    inWorkspace: (workspaceId, work) => withWorkspace(db, workspaceId, (tx) => work(workspaceStore(tx))),
    newId: () => uuidv7(),
  });
}
