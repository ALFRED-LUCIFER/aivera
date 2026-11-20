import type { NewEntry, PlatformAction } from '@credalent/audit';
import { MIN_REASON_LENGTH, STATUS_CHANGES, WorkspaceError, type StatusChange } from '../domain/workspace.ts';
import type { WorkspaceStore } from './workspaces.ts';

export type StatusPorts<Tx> = {
  inWorkspace<T>(workspaceId: string, work: (store: WorkspaceStore, tx: Tx) => Promise<T>): Promise<T>;
};

/**
 * An operator's change, from the console: the operator's identity user id comes from the session, never the form.
 * `reason` may be empty only for a change that needs none (approve).
 */
export type ChangeStatusInput = { operatorId: string; workspaceId: string; change: StatusChange; reason: string };

/** Operator changes to a workspace's status (AIV-P2-037, ADR-012 points 6 to 8). Callers check the operator policy. */
export function statusUseCases<Tx>({ inWorkspace }: StatusPorts<Tx>) {
  return {
    /**
     * Inside withWorkspace(<the workspace>) as the app role: lock the row, check it is still in the change's `from`
     * status, write the new one, run `alongside` in the same transaction, then audit last, in the workspace's log as
     * the operator and in the platform log. Throws `WorkspaceError` (`reason_required`, `not_found`, `status_conflict`).
     */
    async changeStatus(input: ChangeStatusInput, alongside?: (tx: Tx) => Promise<void>): Promise<void> {
      const { operatorId, workspaceId, change } = input;
      const reason = input.reason.trim();
      const { from, to, action, reason: needsReason } = STATUS_CHANGES[change];
      if (needsReason && reason.length < MIN_REASON_LENGTH) throw new WorkspaceError('reason_required');
      return inWorkspace(workspaceId, async (store, tx) => {
        const workspace = await store.lockWorkspaceStatus(workspaceId);
        if (!workspace) throw new WorkspaceError('not_found');
        // A second operator, or a stale page, may have changed it already: refuse rather than record a false "before".
        if (workspace.status !== from) throw new WorkspaceError('status_conflict');
        await store.updateStatus(workspaceId, to);
        await alongside?.(tx);
        const entry: NewEntry & { action: PlatformAction } = {
          action,
          subject: { type: 'workspace', id: workspaceId },
          ...(reason && { note: reason }),
          before: { status: from },
          after: { status: to },
        };
        await store.operatorAudit(workspaceId, operatorId, entry);
      });
    },
  };
}
