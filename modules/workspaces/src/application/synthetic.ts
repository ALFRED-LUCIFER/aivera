import type { Action } from '../domain/permissions.ts';
import { WorkspaceError, type Role, type Workspace } from '../domain/workspace.ts';
import type { WorkspaceContext } from './context.ts';
import type { WorkspaceStore } from './workspaces.ts';

export type SyntheticPorts<Tx> = {
  storeFor(tx: Tx): WorkspaceStore;
  authorize(ctx: WorkspaceContext<Tx>, action: Action): Promise<void>;
};

/** The workspace row, locked until commit; refuses anything not flagged synthetic (AGENTS.md 1.1). */
const lockSynthetic = async (store: WorkspaceStore, workspaceId: string): Promise<Workspace> => {
  const workspace = await store.lockWorkspace(workspaceId);
  if (!workspace?.synthetic) throw new WorkspaceError('not_synthetic');
  return workspace;
};

/** The demo seed's writes (AIV-P0-031). Only ever on a workspace flagged synthetic; every write is audited last. */
export function syntheticUseCases<Tx>({ storeFor, authorize }: SyntheticPorts<Tx>) {
  return {
    /**
     * Admins. Adds an active member straight away, without an invitation: synthetic people cannot accept one.
     * Idempotent: an existing member is left as they are and nothing is audited.
     */
    async addSyntheticMember(ctx: WorkspaceContext<Tx>, userId: string, role: Role): Promise<void> {
      await authorize(ctx, 'member.invite');
      const store = storeFor(ctx.tx);
      await lockSynthetic(store, ctx.workspaceId);
      if (!(await store.insertMember({ workspaceId: ctx.workspaceId, userId, role, status: 'active' }))) return;
      await store.audit(ctx.workspaceId, ctx.userId, {
        action: 'member.added',
        subject: { type: 'member', id: userId },
        after: { role },
      });
    },

    /**
     * Admins. Deletes the workspace's own rows. Other modules purge theirs first in the same `ctx.tx`. Audit entries stay:
     * the log is append-only, and the last one records the purge.
     */
    async purgeSyntheticWorkspace(ctx: WorkspaceContext<Tx>): Promise<void> {
      await authorize(ctx, 'workspace.settings');
      const store = storeFor(ctx.tx);
      await lockSynthetic(store, ctx.workspaceId);
      await store.deleteWorkspace(ctx.workspaceId);
      await store.audit(ctx.workspaceId, ctx.userId, {
        action: 'workspace.purged',
        subject: { type: 'workspace', id: ctx.workspaceId },
      });
    },
  };
}
