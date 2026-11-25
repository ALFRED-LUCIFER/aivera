import { tenantPolicy } from '@credalent/db/tenant-policy';
import { sql } from 'drizzle-orm';
import { bigint, check, index, jsonb, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { ACTIONS, ACTOR_TYPES, PLATFORM_ACTIONS, type Values } from '../domain/entry.ts';

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
      check('entry_actor_type_check', sql`${t.actorType} in ('user', 'system', 'candidate', 'client', 'operator')`),
      check('entry_actor_id_check', sql`${t.actorType} = 'system' or ${t.actorId} is not null`),
      check(
        'entry_action_check',
        sql`${t.action} in ('rubric.approved', 'rubric.submitted', 'rubric.saved', 'rubric.returned', 'score.changed', 'candidate.merged', 'decision.recorded', 'assistant.confirmed', 'member.role_changed', 'workspace.created', 'workspace.type_changed', 'client.added', 'client.renamed', 'client.archived', 'job_access.granted', 'job_access.revoked', 'job.created', 'member.added', 'workspace.purged', 'job.published', 'job.unpublished', 'ai_budget.changed', 'workspace.suspended', 'workspace.reactivated', 'workspace.approved', 'workspace.rejected', 'workspace.settings_changed', 'member.invited', 'invitation.revoked', 'invitation.accepted', 'member.removed', 'job.stage_changed', 'evidence.flag_resolved', 'evidence_request.created', 'evidence_request.sent', 'evidence_request.closed', 'evidence.contradiction_resolved', 'candidate.renamed', 'job.hiring_owner_changed', 'evidence.level_changed', 'candidate.unmerged', 'intake.batch_confirmed', 'file.link_issued')`,
      ),
      check(
        'entry_note_check',
        sql`${t.action} not in ('score.changed', 'decision.recorded', 'ai_budget.changed', 'evidence.contradiction_resolved', 'evidence.level_changed') or coalesce(btrim(${t.note}), '') <> ''`,
      ),
      tenantPolicy('entry_tenant_isolation', t.workspaceId),
    ],
  )
  .enableRLS();

// The platform audit log (ADR-012): what Credalent operators did, outside any workspace, so no workspace id and no tenant
// policy. aivera_app may only INSERT (no SELECT, UPDATE, DELETE or TRUNCATE) and the same append-only triggers as
// audit.entry hold for every role (migration 0010_platform_entry_append_only).
export const platformEntry = audit.table(
  'platform_entry',
  {
    id: uuid().primaryKey(),
    // From the injected clock (AGENTS.md 3.9).
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    // The operator's identity user id (opaque, ADR-009).
    actorId: uuid('actor_id').notNull(),
    action: text({ enum: PLATFORM_ACTIONS }).notNull(),
    subjectType: text('subject_type'),
    subjectId: uuid('subject_id'),
    note: text(),
    before: jsonb().$type<Values>(),
    after: jsonb().$type<Values>(),
  },
  (t) => [
    // Must list exactly PLATFORM_ACTIONS (domain/entry.ts); changing it needs a new migration.
    check(
      'platform_entry_action_check',
      sql`${t.action} in ('ops.console_opened', 'ops.workspace_viewed', 'ai_budget.changed', 'workspace.suspended', 'workspace.reactivated', 'workspace.approved', 'workspace.rejected', 'ops.approval_mode_changed', 'catalogue.draft_opened', 'catalogue.entry_added', 'catalogue.entry_edited', 'catalogue.entry_retired', 'catalogue.entry_removed', 'catalogue.draft_discarded', 'catalogue.eval_requested', 'catalogue.published')`,
    ),
    check('platform_entry_note_check', sql`${t.action} <> 'ai_budget.changed' or coalesce(btrim(${t.note}), '') <> ''`),
    check('platform_entry_subject_check', sql`(${t.subjectType} is null) = (${t.subjectId} is null)`),
  ],
);
