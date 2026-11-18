import type { Tx } from '@aivera/db';
import { assertValidEntry, type Actor, type AuditEntry, type NewEntry, type Subject } from '../domain/entry.ts';

/** The store over one workspace-scoped transaction. Every method filters by `workspaceId`. */
export type AuditStore = {
  insert(entry: AuditEntry): Promise<void>;
  listFor(workspaceId: string, subject: Subject): Promise<AuditEntry[]>;
};

export type Ports = {
  storeFor(tx: Tx): AuditStore;
  /** Runs `work` in one transaction scoped to `workspaceId` (row-level security, ADR-005). */
  inWorkspace<T>(workspaceId: string, work: (store: AuditStore) => Promise<T>): Promise<T>;
  newId(): string;
  now(): Date;
};

/**
 * Who is writing, from the request context, and the caller's own `withWorkspace(workspaceId)` transaction, so the
 * entry commits or rolls back with the change it records.
 */
export type AuditContext = { tx: Tx; workspaceId: string; actor: Actor; correlationId?: string };

export function auditUseCases({ storeFor, inWorkspace, newId, now }: Ports) {
  return {
    async record({ tx, workspaceId, actor, correlationId }: AuditContext, input: NewEntry): Promise<void> {
      assertValidEntry(input);
      const { action, subject, note, before, after } = input;
      const entry: AuditEntry = {
        id: newId(),
        workspaceId,
        occurredAt: now(),
        actor,
        action,
        subject,
        note: note ?? null,
        before: before ?? null,
        after: after ?? null,
        correlationId: correlationId ?? null,
      };
      await storeFor(tx).insert(entry);
    },

    listFor(workspaceId: string, subject: Subject): Promise<AuditEntry[]> {
      return inWorkspace(workspaceId, (store) => store.listFor(workspaceId, subject));
    },
  };
}
