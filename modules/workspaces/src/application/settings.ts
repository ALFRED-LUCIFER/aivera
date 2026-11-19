import type { Action } from '../domain/permissions.ts';
import { parseSettingsPatch, withDefaults, type SettingsPatch, type WorkspaceSettings } from '../domain/settings.ts';
import type { WorkspaceContext } from './context.ts';
import type { WorkspaceStore } from './workspaces.ts';

export type SettingsPorts<Tx> = {
  storeFor(tx: Tx): WorkspaceStore;
  authorize(ctx: WorkspaceContext<Tx>, action: Action): Promise<void>;
};

/** Workspace settings (AIV-P1-051): read at call time, so a change applies going forward only. */
export function settingsUseCases<Tx>({ storeFor, authorize }: SettingsPorts<Tx>) {
  return {
    /** Every member: the stored values over the approved defaults. */
    async getSettings(ctx: WorkspaceContext<Tx>): Promise<WorkspaceSettings> {
      return withDefaults(await storeFor(ctx.tx).readSettings(ctx.workspaceId));
    },

    /** Admins only. Refuses the whole patch on the first bad value; audits each changed key's old and new value, last. */
    async updateSettings(ctx: WorkspaceContext<Tx>, patch: SettingsPatch): Promise<WorkspaceSettings> {
      await authorize(ctx, 'workspace.settings');
      const changes = parseSettingsPatch(patch);
      const store = storeFor(ctx.tx);
      // Serialises concurrent changes, so each audit entry records a true "before".
      await store.lockWorkspace(ctx.workspaceId);
      const current = withDefaults(await store.readSettings(ctx.workspaceId));
      const changed = (Object.keys(changes) as (keyof WorkspaceSettings)[]).filter(
        (k) => changes[k] !== undefined && changes[k] !== current[k],
      );
      if (changed.length === 0) return current;
      const only = (s: SettingsPatch) =>
        Object.fromEntries(changed.map((k) => [k, s[k]])) as Record<string, number | boolean>;
      const next: WorkspaceSettings = { ...current, ...only(changes) };
      await store.writeSettings(ctx.workspaceId, next, ctx.userId);
      await store.audit(ctx.workspaceId, ctx.userId, {
        action: 'workspace.settings_changed',
        subject: { type: 'workspace', id: ctx.workspaceId },
        before: only(current),
        after: only(next),
      });
      return next;
    },
  };
}
