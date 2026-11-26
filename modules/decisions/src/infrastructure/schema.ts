import { inboxTable, outboxTable } from '@credalent/db/outbox';
import { tenantPolicy } from '@credalent/db/tenant-policy';
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { DECISIONS, STATUSES } from '../domain/pack.ts';
import { SUMMARY_STATUSES, type MemberSummary } from '../domain/summary.ts';

export const decisions = pgSchema('decisions');

// job_id, rubric_version_id, candidate_id, assessment_id and the user ids are opaque ids of other modules' records: no
// foreign keys across modules (AGENTS.md 3.3).
export const pack = decisions
  .table(
    'pack',
    {
      id: uuid().primaryKey(),
      workspaceId: uuid('workspace_id').notNull(),
      jobId: uuid('job_id').notNull(),
      rubricVersionId: uuid('rubric_version_id').notNull(),
      name: text().notNull(),
      preparedBy: uuid('prepared_by').notNull(),
      // From the injected clock (AGENTS.md 3.9).
      preparedAt: timestamp('prepared_at', { withTimezone: true }).notNull(),
      status: text({ enum: STATUSES }).notNull(),
    },
    (t) => [
      unique('pack_workspace_id_key').on(t.workspaceId, t.id),
      // Must list exactly STATUSES (domain/pack.ts); changing it needs a migration.
      check('pack_status_check', sql`${t.status} in ('draft', 'ready', 'decided')`),
      // NAME_MAX (domain/pack.ts).
      check('pack_name_check', sql`btrim(${t.name}) <> '' and char_length(${t.name}) <= 120`),
      tenantPolicy('pack_tenant_isolation', t.workspaceId),
    ],
  )
  .enableRLS();

// A member is its candidate's assessment snapshot when the pack was prepared. The app role may not UPDATE or DELETE
// this table (0001_force_rls_and_grants.sql), so a later score change cannot reach a snapshot and a member cannot be dropped.
// shortcut: candidate_id is copied when the member is added; a duplicate merge afterwards (AIV-P1-018) leaves the
// merged person's id here. Move it in the merge, as evidence's records are, when the pack page shows names (AIV-P2-011).
export const packMember = decisions
  .table(
    'pack_member',
    {
      workspaceId: uuid('workspace_id').notNull(),
      packId: uuid('pack_id').notNull(),
      candidateId: uuid('candidate_id').notNull(),
      assessmentId: uuid('assessment_id').notNull(),
      backedScore: integer('backed_score').notNull(),
      upperBound: integer('upper_bound').notNull(),
      position: integer().notNull(),
      // Who added the member, from the injected clock (AIV-P1-139); null on members added before these were stored.
      addedBy: uuid('added_by'),
      addedAt: timestamp('added_at', { withTimezone: true }),
    },
    (t) => [
      // A candidate appears once per pack.
      primaryKey({ name: 'pack_member_pkey', columns: [t.workspaceId, t.packId, t.candidateId] }),
      // Includes the workspace, so a member cannot point at another workspace's pack (FK checks skip RLS).
      foreignKey({
        name: 'pack_member_pack_fk',
        columns: [t.workspaceId, t.packId],
        foreignColumns: [pack.workspaceId, pack.id],
      }),
      unique('pack_member_position_key').on(t.workspaceId, t.packId, t.position),
      check('pack_member_position_check', sql`${t.position} >= 0`),
      check('pack_member_added_check', sql`(${t.addedBy} is null) = (${t.addedAt} is null)`),
      check(
        'pack_member_score_check',
        sql`${t.backedScore} >= 0 and ${t.backedScore} <= ${t.upperBound} and ${t.upperBound} <= 100`,
      ),
      tenantPolicy('pack_member_tenant_isolation', t.workspaceId),
    ],
  )
  .enableRLS();

// The hiring owner's decision on one member, once. Append-only: the app role may not UPDATE or DELETE it.
export const decision = decisions
  .table(
    'decision',
    {
      workspaceId: uuid('workspace_id').notNull(),
      packId: uuid('pack_id').notNull(),
      candidateId: uuid('candidate_id').notNull(),
      decision: text({ enum: DECISIONS }).notNull(),
      decidedBy: uuid('decided_by').notNull(),
      decidedAt: timestamp('decided_at', { withTimezone: true }).notNull(),
      // A person's free text about a candidate: never log a row (AGENTS.md 1.2).
      note: text().notNull(),
    },
    (t) => [
      // One decision per member.
      primaryKey({ name: 'decision_pkey', columns: [t.workspaceId, t.packId, t.candidateId] }),
      // Only a member of the pack can be decided on.
      foreignKey({
        name: 'decision_member_fk',
        columns: [t.workspaceId, t.packId, t.candidateId],
        foreignColumns: [packMember.workspaceId, packMember.packId, packMember.candidateId],
      }),
      // Must list exactly DECISIONS (domain/pack.ts); changing it needs a migration.
      check('decision_decision_check', sql`${t.decision} in ('advance', 'hold', 'do_not_advance')`),
      // NOTE_MAX (domain/pack.ts).
      check('decision_note_check', sql`btrim(${t.note}) <> '' and char_length(${t.note}) <= 1000`),
      tenantPolicy('decision_tenant_isolation', t.workspaceId),
    ],
  )
  .enableRLS();

// A member's strengths, risks, Round 1 finding and Credalent's recommendation (AIV-P2-011), written once by the worker
// for the snapshot the member joined with. The app role may not UPDATE or DELETE it (0004_force_rls_and_grants.sql).
export const memberSummary = decisions
  .table(
    'member_summary',
    {
      workspaceId: uuid('workspace_id').notNull(),
      packId: uuid('pack_id').notNull(),
      candidateId: uuid('candidate_id').notNull(),
      status: text({ enum: SUMMARY_STATUSES }).notNull(),
      promptVersion: text('prompt_version'),
      // Generated text and quotes about a candidate: never log a row (AGENTS.md 1.2). Parsed on read (domain/summary.ts).
      summary: jsonb().$type<MemberSummary>(),
      // From the injected clock (AGENTS.md 3.9).
      createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    },
    (t) => [
      // One summary per member.
      primaryKey({ name: 'member_summary_pkey', columns: [t.workspaceId, t.packId, t.candidateId] }),
      foreignKey({
        name: 'member_summary_member_fk',
        columns: [t.workspaceId, t.packId, t.candidateId],
        foreignColumns: [packMember.workspaceId, packMember.packId, packMember.candidateId],
      }),
      // Must list exactly SUMMARY_STATUSES (domain/summary.ts); changing it needs a migration.
      check('member_summary_status_check', sql`${t.status} in ('ready', 'unavailable')`),
      // Text only when ready, and a ready summary names its prompt.
      check(
        'member_summary_ready_check',
        sql`(${t.status} = 'ready') = (${t.summary} is not null) and (${t.status} = 'ready') = (${t.promptVersion} is not null)`,
      ),
      tenantPolicy('member_summary_tenant_isolation', t.workspaceId),
    ],
  )
  .enableRLS();

// Events written in the same transaction as the change; the relay sends them to Service Bus (AIV-P0-014).
export const outbox = outboxTable(decisions);

// One row per message the worker's summary job has handled (AIV-P2-011), so a redelivery is skipped.
export const inbox = inboxTable(decisions);
