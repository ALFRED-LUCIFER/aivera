import { outboxTable } from '@credalent/db/outbox';
import { tenantPolicy } from '@credalent/db/tenant-policy';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { IDENTIFIER_TYPES } from '../domain/person.ts';

export const candidates = pgSchema('candidates');

// Every column but the ids, flags and time is candidate personal data (PERSONAL_DATA_FIELDS): never log a row.
export const person = candidates
  .table(
    'person',
    {
      id: uuid().primaryKey(),
      workspaceId: uuid('workspace_id').notNull(),
      displayName: text('display_name').notNull(),
      emails: text().array().notNull(),
      phones: text().array().notNull(),
      location: text(),
      // No default: every insert states it (AGENTS.md 1.1).
      synthetic: boolean().notNull(),
      mergedIntoId: uuid('merged_into_id'),
      // From the injected clock (AGENTS.md 3.9).
      createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    },
    (t) => [
      unique('person_workspace_id_key').on(t.workspaceId, t.id),
      index('person_workspace_created_idx').on(t.workspaceId, t.createdAt, t.id),
      tenantPolicy('person_tenant_isolation', t.workspaceId),
    ],
  )
  .enableRLS();

export const personIdentifier = candidates
  .table(
    'person_identifier',
    {
      workspaceId: uuid('workspace_id').notNull(),
      type: text({ enum: IDENTIFIER_TYPES }).notNull(),
      // Normalised by the domain (normaliseIdentifier) before it is stored.
      value: text().notNull(),
      personId: uuid('person_id').notNull(),
    },
    (t) => [
      // Includes the workspace, so an identifier cannot point at another workspace's person (FK checks skip RLS).
      foreignKey({
        name: 'person_identifier_person_fk',
        columns: [t.workspaceId, t.personId],
        foreignColumns: [person.workspaceId, person.id],
      }),
      // One person per identifier in a workspace; the same email in another workspace is another person.
      primaryKey({ name: 'person_identifier_pkey', columns: [t.workspaceId, t.type, t.value] }),
      index('person_identifier_person_idx').on(t.workspaceId, t.personId),
      // Must list exactly IDENTIFIER_TYPES (domain/person.ts); changing it needs a new migration.
      check('person_identifier_type_check', sql`${t.type} in ('email', 'phone', 'cv_hash', 'github_login')`),
      tenantPolicy('person_identifier_tenant_isolation', t.workspaceId),
    ],
  )
  .enableRLS();

// One merge of a duplicate into the person who stays (AIV-P1-018), and its undo. `moved` holds the opaque ids each
// module moved, so an undo moves back exactly those. `reason` is a person's free text: never log a row.
export const merge = candidates
  .table(
    'merge',
    {
      id: uuid().primaryKey(),
      workspaceId: uuid('workspace_id').notNull(),
      survivorId: uuid('survivor_id').notNull(),
      mergedId: uuid('merged_id').notNull(),
      reason: text().notNull(),
      automatic: boolean().notNull(),
      // The member who confirmed it; null when Credalent merged exact duplicates itself.
      mergedBy: uuid('merged_by'),
      mergedAt: timestamp('merged_at', { withTimezone: true }).notNull(),
      // From the workspace's mergeUndoDays when merged, so a later settings change applies going forward only.
      undoUntil: timestamp('undo_until', { withTimezone: true }).notNull(),
      moved: jsonb().$type<Record<string, unknown>>().notNull(),
      undoneAt: timestamp('undone_at', { withTimezone: true }),
      undoneBy: uuid('undone_by'),
      undoReason: text('undo_reason'),
    },
    (t) => [
      foreignKey({
        name: 'merge_survivor_fk',
        columns: [t.workspaceId, t.survivorId],
        foreignColumns: [person.workspaceId, person.id],
      }),
      foreignKey({
        name: 'merge_merged_fk',
        columns: [t.workspaceId, t.mergedId],
        foreignColumns: [person.workspaceId, person.id],
      }),
      // A person is merged into one other at a time.
      uniqueIndex('merge_active_key')
        .on(t.workspaceId, t.mergedId)
        .where(sql`${t.undoneAt} is null`),
      index('merge_survivor_idx').on(t.workspaceId, t.survivorId),
      check('merge_people_check', sql`${t.survivorId} <> ${t.mergedId}`),
      check('merge_reason_check', sql`btrim(${t.reason}) <> ''`),
      // Undone means a time, a person and a reason, together.
      check(
        'merge_undone_check',
        sql`(${t.undoneAt} is null) = (${t.undoneBy} is null) and (${t.undoneAt} is null) = (${t.undoReason} is null)`,
      ),
      tenantPolicy('merge_tenant_isolation', t.workspaceId),
    ],
  )
  .enableRLS();

// Events written in the same transaction as the change; the relay sends them to Service Bus (AIV-P0-014).
export const outbox = outboxTable(candidates);
