import type { AuditContract } from '@aivera/audit';
import type { Tx } from '@aivera/db/client';
import { sql } from 'drizzle-orm';
import type { SettingsStore } from '../application/settings.ts';
import { platformSetting } from './schema.ts';

/** The settings store over one transaction; the platform audit write joins that transaction. */
export function settingsStore(tx: Tx, audit: Pick<AuditContract, 'recordPlatform'>): SettingsStore {
  return {
    async approvalRequired(options) {
      const query = tx.select({ value: platformSetting.approvalRequired }).from(platformSetting);
      const [row] = await (options?.lock ? query.for('update') : query);
      return row?.value ?? null;
    },
    async setApprovalRequired(required, operatorId) {
      // shortcut: the database clock, as for created_at elsewhere; move to the Clock port when this module has one.
      await tx
        .update(platformSetting)
        .set({ approvalRequired: required, updatedBy: operatorId, updatedAt: sql`now()` });
    },
    recordPlatform: (entry) => audit.recordPlatform(entry, tx),
  };
}
