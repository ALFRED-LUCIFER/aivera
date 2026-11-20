// Builds the audit module for an app (ADR-002: only apps import this).
// Not the @aivera/db index: it also exports the migrator, whose module paths do not resolve inside a Next.js bundle.
import type { Db } from '@aivera/db/client';
import { uuidv7 } from '@aivera/db/uuidv7';
import { withWorkspace } from '@aivera/db/with-workspace';
import { auditUseCases } from './application/audit.ts';
import type { AuditContract } from './contracts/index.ts';
import { auditStore, insertPlatformEntry, selectPlatformEntries } from './infrastructure/repository.ts';

/** `now` is the injected clock (AGENTS.md 3.9); tests pass a fixed one. */
export function createAudit(db: Db, now: () => Date = () => new Date()): AuditContract {
  return auditUseCases({
    storeFor: auditStore,
    inWorkspace: (workspaceId, work) => withWorkspace(db, workspaceId, (tx) => work(auditStore(tx))),
    insertPlatform: (entry, tx) =>
      tx ? insertPlatformEntry(tx, entry) : db.transaction((t) => insertPlatformEntry(t, entry)),
    readPlatform: (filter) => db.transaction((t) => selectPlatformEntries(t, filter)),
    newId: () => uuidv7(),
    now,
  });
}
