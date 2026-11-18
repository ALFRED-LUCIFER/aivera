import { tenantPolicy } from '@aivera/db/tenant-policy';
import { pgSchema, text, uuid } from 'drizzle-orm/pg-core';

// A workspace-owned table in the shape every module uses (ADR-004, ADR-005).
export const fixtureNotes = pgSchema('fixture_notes');

export const notes = fixtureNotes
  .table(
    'notes',
    {
      id: uuid().primaryKey(),
      workspaceId: uuid('workspace_id').notNull(),
      body: text().notNull(),
    },
    (t) => [tenantPolicy('notes_workspace_isolation', t.workspaceId)],
  )
  .enableRLS();
