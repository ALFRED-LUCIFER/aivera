import type { Tx } from '@aivera/db';
import { and, asc, eq } from 'drizzle-orm';
import type { AuditStore } from '../application/audit.ts';
import type { Actor, AuditEntry, PlatformEntry } from '../domain/entry.ts';
import { entry, platformEntry } from './schema.ts';

type Row = typeof entry.$inferSelect;

const toEntry = ({ actorType, actorId, subjectType, subjectId, seq: _seq, ...rest }: Row): AuditEntry => ({
  ...rest,
  // entry_actor_id_check guarantees actor_id is set for every actor but system.
  actor: (actorType === 'system' ? { type: 'system' } : { type: actorType, id: actorId }) as Actor,
  subject: { type: subjectType, id: subjectId },
});

/**
 * The audit store over a workspace-scoped transaction. The `workspace_id` filter here is the first layer;
 * row-level security on the transaction's `app.workspace_id` is the second (ADR-005).
 */
export function auditStore(tx: Tx): AuditStore {
  return {
    async insert({ actor, subject, ...rest }) {
      await tx.insert(entry).values({
        ...rest,
        actorType: actor.type,
        actorId: actor.type === 'system' ? null : actor.id,
        subjectType: subject.type,
        subjectId: subject.id,
      });
    },
    async listFor(workspaceId, subject) {
      const rows = await tx
        .select()
        .from(entry)
        .where(
          and(eq(entry.workspaceId, workspaceId), eq(entry.subjectType, subject.type), eq(entry.subjectId, subject.id)),
        )
        .orderBy(asc(entry.occurredAt), asc(entry.seq));
      return rows.map(toEntry);
    },
  };
}

/** Inserts one platform entry; aivera_app may only insert into `audit.platform_entry`, never read or change it. */
export async function insertPlatformEntry(tx: Tx, { subject, ...rest }: PlatformEntry): Promise<void> {
  await tx
    .insert(platformEntry)
    .values({ ...rest, subjectType: subject?.type ?? null, subjectId: subject?.id ?? null });
}
