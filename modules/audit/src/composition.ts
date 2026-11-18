// Builds the audit module for an app (ADR-002: only apps import this).
import { uuidv7, withWorkspace, type Db } from '@aivera/db';
import { auditUseCases } from './application/audit.ts';
import type { AuditContract } from './contracts/index.ts';
import { auditStore } from './infrastructure/repository.ts';

/** `now` is the injected clock (AGENTS.md 3.9); tests pass a fixed one. */
export function createAudit(db: Db, now: () => Date = () => new Date()): AuditContract {
  return auditUseCases({
    storeFor: auditStore,
    inWorkspace: (workspaceId, work) => withWorkspace(db, workspaceId, (tx) => work(auditStore(tx))),
    newId: () => uuidv7(),
    now,
  });
}
