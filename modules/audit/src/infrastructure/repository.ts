import type { Tx } from '@credalent/db';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { AuditStore } from '../application/audit.ts';
import type { Actor, AuditEntry, PlatformAction, PlatformEntry, PlatformEntryFilter, Values } from '../domain/entry.ts';
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
    async listOperatorEntries(workspaceId) {
      const rows = await tx
        .select()
        .from(entry)
        .where(
          and(
            eq(entry.workspaceId, workspaceId),
            eq(entry.actorType, 'operator'),
            eq(entry.subjectType, 'workspace'),
            eq(entry.subjectId, workspaceId),
          ),
        )
        .orderBy(asc(entry.occurredAt), asc(entry.seq));
      return rows.map(toEntry);
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

type PlatformRow = {
  id: string;
  occurred_at: string;
  actor_id: string;
  action: PlatformAction;
  subject_type: string | null;
  subject_id: string | null;
  note: string | null;
  before: Values | null;
  after: Values | null;
};

/** One page of the platform log through `audit.list_platform_entries`, the app role's only read of it (ADR-012). */
export async function selectPlatformEntries(
  tx: Tx,
  { action, actorId, targetId, from, to, cursor, pageSize }: PlatformEntryFilter,
): Promise<PlatformEntry[]> {
  const rows = await tx.execute<PlatformRow>(sql`select * from audit.list_platform_entries(
    ${action ?? null}::text, ${actorId ?? null}::uuid, ${targetId ?? null}::uuid, ${from?.toISOString() ?? null}::timestamptz,
    ${to?.toISOString() ?? null}::timestamptz, ${cursor ?? null}::uuid, ${pageSize}::int)`);
  return rows.map(({ occurred_at, actor_id, subject_type, subject_id, ...rest }) => ({
    ...rest,
    occurredAt: new Date(occurred_at),
    actorId: actor_id,
    subject: subject_type && subject_id ? { type: subject_type, id: subject_id } : null,
  }));
}
