// Builds the ops module for an app (ADR-002: only apps import this).
import type { AuditContract } from '@aivera/audit';
import type { Db } from '@aivera/db/client';
import { settingsUseCases } from './application/settings.ts';
import type { OpsSettingsContract } from './contracts/index.ts';
import { settingsStore } from './infrastructure/repository.ts';

/** The platform settings on the app's pool: a platform table, not workspace-owned, so no workspace scope. */
export function createOpsSettings(db: Db, audit: Pick<AuditContract, 'recordPlatform'>): OpsSettingsContract {
  return settingsUseCases({ inTransaction: (work) => db.transaction((tx) => work(settingsStore(tx, audit))) });
}
