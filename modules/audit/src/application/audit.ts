import type { Tx } from '@credalent/db';
import {
  assertValidEntry,
  assertValidPlatformEntry,
  type Actor,
  type AuditEntry,
  type NewEntry,
  type NewPlatformEntry,
  type PlatformEntry,
  type PlatformEntryFilter,
  type PlatformEntryPage,
  type PlatformEntryQuery,
  platformEntryQuerySchema,
  type Subject,
} from '../domain/entry.ts';

/** The store over one workspace-scoped transaction. Every method filters by `workspaceId`. */
export type AuditStore = {
  insert(entry: AuditEntry): Promise<void>;
  listFor(workspaceId: string, subject: Subject): Promise<AuditEntry[]>;
  /** Entries about the workspace itself written by an operator, oldest first. */
  listOperatorEntries(workspaceId: string): Promise<AuditEntry[]>;
};

export type Ports = {
  storeFor(tx: Tx): AuditStore;
  /** Runs `work` in one transaction scoped to `workspaceId` (row-level security, ADR-005). */
  inWorkspace<T>(workspaceId: string, work: (store: AuditStore) => Promise<T>): Promise<T>;
  /** Appends one platform entry in `tx`, or in its own transaction: it belongs to no workspace (ADR-012). */
  insertPlatform(entry: PlatformEntry, tx?: Tx): Promise<void>;
  /** One page of the platform log through its named read function (ADR-012 point 8), newest first. */
  readPlatform(filter: PlatformEntryFilter): Promise<PlatformEntry[]>;
  newId(): string;
  now(): Date;
};

/**
 * Who is writing, from the request context, and the caller's own `withWorkspace(workspaceId)` transaction, so the
 * entry commits or rolls back with the change it records.
 */
export type AuditContext = { tx: Tx; workspaceId: string; actor: Actor; correlationId?: string };

export function auditUseCases({ storeFor, inWorkspace, insertPlatform, readPlatform, newId, now }: Ports) {
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

    listOperatorEntries(workspaceId: string): Promise<AuditEntry[]> {
      return inWorkspace(workspaceId, (store) => store.listOperatorEntries(workspaceId));
    },

    async listPlatformEntries(query: PlatformEntryQuery = {}): Promise<PlatformEntryPage> {
      // Throws a ZodError before any query: a page size over 50, a malformed cursor, an unknown key.
      const filter = platformEntryQuerySchema.parse(query);
      const entries = await readPlatform(filter);
      return { entries, nextCursor: entries.length === filter.pageSize ? (entries.at(-1)?.id ?? null) : null };
    },

    async recordPlatform(input: NewPlatformEntry, tx?: Tx): Promise<void> {
      assertValidPlatformEntry(input);
      const { actorId, action, subject, note, before, after } = input;
      await insertPlatform(
        {
          id: newId(),
          occurredAt: now(),
          actorId,
          action,
          subject: subject ?? null,
          note: note ?? null,
          before: before ?? null,
          after: after ?? null,
        },
        tx,
      );
    },
  };
}
