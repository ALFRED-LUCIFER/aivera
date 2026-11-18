import { sql } from 'drizzle-orm';
import { pgPolicy, pgSchema, text, uuid } from 'drizzle-orm/pg-core';

// A workspace-owned table in the shape every module uses (ADR-004, ADR-005).
export const fixtureNotes = pgSchema('fixture_notes');

const currentWorkspace = sql`nullif(current_setting('app.workspace_id', true), '')::uuid`;

export const notes = fixtureNotes
  .table(
    'notes',
    {
      id: uuid().primaryKey(),
      workspaceId: uuid('workspace_id').notNull(),
      body: text().notNull(),
    },
    (t) => [
      pgPolicy('notes_workspace_isolation', {
        for: 'all',
        using: sql`${t.workspaceId} = ${currentWorkspace}`,
        withCheck: sql`${t.workspaceId} = ${currentWorkspace}`,
      }),
    ],
  )
  .enableRLS();
