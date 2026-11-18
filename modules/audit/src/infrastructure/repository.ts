import type { Tx } from '@aivera/db';
import { and, asc, eq } from 'drizzle-orm';
import type { AuditStore } from '../application/audit.ts';
import type { Actor, AuditEntry } from '../domain/entry.ts';
import { entry } from './schema.ts';

type Row = typeof entry.$inferSelect;

const toEntry = ({ actorType, actorId, subjectType, subjectId, ...rest }: Row): AuditEntry => ({
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
        .orderBy(asc(entry.occurredAt), asc(entry.id));
      return rows.map(toEntry);
    },
  };
}
