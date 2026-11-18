import { tenantPolicy } from '@aivera/db/tenant-policy';
import { sql } from 'drizzle-orm';
import { bigint, check, index, jsonb, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { ACTIONS, ACTOR_TYPES, type Values } from '../domain/entry.ts';

export const audit = pgSchema('audit');

// Append-only: aivera_app has INSERT and SELECT only, and a trigger refuses UPDATE, DELETE and TRUNCATE for every
// role (migration 0001_append_only, module README).
export const entry = audit
  .table(
    'entry',
    {
      id: uuid().primaryKey(),
      workspaceId: uuid('workspace_id').notNull(),
      // From the injected clock, not the database's now() (AGENTS.md 3.9).
      occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
      actorType: text('actor_type', { enum: ACTOR_TYPES }).notNull(),
      actorId: uuid('actor_id'),
      action: text({ enum: ACTIONS }).notNull(),
      subjectType: text('subject_type').notNull(),
      subjectId: uuid('subject_id').notNull(),
      note: text(),
      before: jsonb().$type<Values>(),
      after: jsonb().$type<Values>(),
      correlationId: uuid('correlation_id'),
      // Insertion order, the tiebreak for entries from one clock reading (AIV-P0-925); listFor orders by it.
      seq: bigint({ mode: 'number' }).generatedAlwaysAsIdentity().notNull(),
    },
    (t) => [
      index('entry_subject_idx').on(t.workspaceId, t.subjectType, t.subjectId, t.occurredAt, t.seq),
      // Must list exactly ACTOR_TYPES and ACTIONS (domain/entry.ts); changing either needs a new migration.
      check('entry_actor_type_check', sql`${t.actorType} in ('user', 'system', 'candidate', 'client')`),
      check('entry_actor_id_check', sql`${t.actorType} = 'system' or ${t.actorId} is not null`),
      check(
        'entry_action_check',
        sql`${t.action} in ('rubric.approved', 'score.changed', 'candidate.merged', 'decision.recorded', 'assistant.confirmed', 'member.role_changed', 'workspace.created', 'workspace.type_changed', 'client.added', 'client.renamed', 'client.archived', 'job_access.granted', 'job_access.revoked', 'job.created', 'member.added', 'workspace.purged')`,
      ),
      check(
        'entry_note_check',
        sql`${t.action} not in ('score.changed', 'decision.recorded') or coalesce(btrim(${t.note}), '') <> ''`,
      ),
      tenantPolicy('entry_tenant_isolation', t.workspaceId),
    ],
  )
  .enableRLS();
