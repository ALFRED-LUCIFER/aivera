import type { NewPlatformEntry } from '@aivera/audit';
import { DEFAULT_APPROVAL_REQUIRED, MIN_REASON_LENGTH, OpsError } from '../domain/settings.ts';

/** The settings row, locked for the change, and the platform audit write, all in one transaction. */
export type SettingsStore = {
  /** The stored value; null when no operator has changed it yet. */
  approvalRequired(options?: { lock: boolean }): Promise<boolean | null>;
  setApprovalRequired(required: boolean, operatorId: string): Promise<void>;
  /** The platform audit log, in this transaction (last statement before commit, AGENTS.md 3.6). */
  recordPlatform(entry: NewPlatformEntry): Promise<void>;
};

export type Ports = { inTransaction<T>(work: (store: SettingsStore) => Promise<T>): Promise<T> };

/** An operator's change, from the console: the operator's id comes from the session, never the form. */
export type SetApprovalRequiredInput = { operatorId: string; required: boolean; reason: string };

export function settingsUseCases({ inTransaction }: Ports) {
  return {
    async approvalRequired(): Promise<boolean> {
      return (await inTransaction((store) => store.approvalRequired())) ?? DEFAULT_APPROVAL_REQUIRED;
    },

    async setApprovalRequired({ operatorId, required, reason: raw }: SetApprovalRequiredInput): Promise<void> {
      const reason = raw.trim();
      if (reason.length < MIN_REASON_LENGTH) throw new OpsError('reason_required');
      await inTransaction(async (store) => {
        const before = (await store.approvalRequired({ lock: true })) ?? DEFAULT_APPROVAL_REQUIRED;
        // A second operator, or a stale page, may have changed it already: refuse rather than record a false "before".
        if (before === required) throw new OpsError('unchanged');
        // Only the setting changes: workspaces already waiting stay waiting until an operator decides each one.
        await store.setApprovalRequired(required, operatorId);
        await store.recordPlatform({
          actorId: operatorId,
          action: 'ops.approval_mode_changed',
          note: reason,
          before: { approvalRequired: before },
          after: { approvalRequired: required },
        });
      });
    },
  };
}
