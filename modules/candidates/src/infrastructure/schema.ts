import { tenantPolicy } from '@aivera/db/tenant-policy';
import { sql } from 'drizzle-orm';
import { boolean, check, index, pgSchema, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
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
      personId: uuid('person_id')
        .notNull()
        .references(() => person.id),
    },
    (t) => [
      // One person per identifier in a workspace; the same email in another workspace is another person.
      primaryKey({ name: 'person_identifier_pkey', columns: [t.workspaceId, t.type, t.value] }),
      index('person_identifier_person_idx').on(t.personId),
      // Must list exactly IDENTIFIER_TYPES (domain/person.ts); changing it needs a new migration.
      check('person_identifier_type_check', sql`${t.type} in ('email', 'phone', 'cv_hash', 'github_login')`),
      tenantPolicy('person_identifier_tenant_isolation', t.workspaceId),
    ],
  )
  .enableRLS();
