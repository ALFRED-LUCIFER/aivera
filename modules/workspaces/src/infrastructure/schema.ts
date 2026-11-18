import { tenantPolicy } from '@aivera/db/tenant-policy';
import { sql } from 'drizzle-orm';
import { boolean, check, pgSchema, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { MEMBER_STATUSES, ROLES } from '../domain/workspace.ts';

export const workspaces = pgSchema('workspaces');

// A workspace's own id is its tenant key: inside withWorkspace(W) only W is visible (module README).
export const workspace = workspaces
  .table(
    'workspace',
    {
      id: uuid().primaryKey(),
      name: text().notNull(),
      company: text().notNull(),
      hiringFocus: text('hiring_focus').notNull(),
      synthetic: boolean().notNull().default(false),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [tenantPolicy('workspace_tenant_isolation', t.id)],
  )
  .enableRLS();

export const member = workspaces
  .table(
    'member',
    {
      workspaceId: uuid('workspace_id')
        .notNull()
        .references(() => workspace.id),
      // Opaque id of the identity module's user (ADR-004 6: no foreign key across modules).
      userId: uuid('user_id').notNull(),
      role: text({ enum: ROLES }).notNull(),
      status: text({ enum: MEMBER_STATUSES }).notNull(),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      primaryKey({ columns: [t.workspaceId, t.userId] }),
      // Must list exactly ROLES and MEMBER_STATUSES (domain/workspace.ts); changing either needs a new migration.
      check('member_role_check', sql`${t.role} in ('admin', 'recruiter', 'hiring_owner', 'interviewer')`),
      check('member_status_check', sql`${t.status} in ('invited', 'active', 'removed')`),
      tenantPolicy('member_tenant_isolation', t.workspaceId),
    ],
  )
  .enableRLS();

// The user's active workspace, held server-side because the session cookie holds only the user id (ADR-009).
// Keyed on the user, not workspace-owned, so no tenant policy: it is read before any workspace is open and holds two
// opaque ids. The request context re-checks membership on every request, so a stale row grants nothing.
// shortcut: the foreign key blocks deleting a workspace that is someone's active one; workspace deletion (not built)
// must clear these rows first or move the key to ON DELETE CASCADE.
export const activeWorkspace = workspaces.table('active_workspace', {
  userId: uuid('user_id').primaryKey(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspace.id),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
