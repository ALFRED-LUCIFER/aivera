import { tenantPolicy } from '@aivera/db/tenant-policy';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { MEMBER_STATUSES, ROLES, WORKSPACE_TYPES } from '../domain/workspace.ts';

export const workspaces = pgSchema('workspaces');

// A workspace's own id is its tenant key: inside withWorkspace(W) only W is visible (module README).
export const workspace = workspaces
  .table(
    'workspace',
    {
      id: uuid().primaryKey(),
      type: text({ enum: WORKSPACE_TYPES }).notNull().default('in_house'),
      name: text().notNull(),
      company: text().notNull(),
      hiringFocus: text('hiring_focus').notNull(),
      synthetic: boolean().notNull().default(false),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      check('workspace_type_check', sql`${t.type} in ('in_house', 'agency')`),
      tenantPolicy('workspace_tenant_isolation', t.id),
    ],
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

// An agency's client (ADR-005 point 6). Only an agency workspace adds them (enforced in the use case under a lock on the
// workspace row). Never deleted: archived, so old jobs and audit entries keep resolving.
export const client = workspaces
  .table(
    'client',
    {
      id: uuid().primaryKey(),
      workspaceId: uuid('workspace_id')
        .notNull()
        .references(() => workspace.id),
      name: text().notNull(),
      archivedAt: timestamp('archived_at', { withTimezone: true }),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      uniqueIndex('client_workspace_name_idx').on(t.workspaceId, sql`lower(${t.name})`),
      // The target of job_grant's composite key, so a grant can only name a client of its own workspace.
      unique('client_workspace_id_key').on(t.workspaceId, t.id),
      check('client_name_check', sql`btrim(${t.name}) <> ''`),
      tenantPolicy('client_tenant_isolation', t.workspaceId),
    ],
  )
  .enableRLS();

// A hiring owner's or interviewer's access to one job, or to all of one client's jobs. Job ids are opaque ids of the
// jobs module (no foreign key across modules, ADR-004 6); clients and members are keyed with the workspace, so a grant
// never reaches another workspace's client or member even though key checks bypass row-level security.
export const jobGrant = workspaces
  .table(
    'job_grant',
    {
      id: uuid().primaryKey(),
      workspaceId: uuid('workspace_id')
        .notNull()
        .references(() => workspace.id),
      userId: uuid('user_id').notNull(),
      jobId: uuid('job_id'),
      clientId: uuid('client_id'),
      grantedBy: uuid('granted_by').notNull(),
      grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      foreignKey({ columns: [t.workspaceId, t.userId], foreignColumns: [member.workspaceId, member.userId] }),
      foreignKey({ columns: [t.workspaceId, t.clientId], foreignColumns: [client.workspaceId, client.id] }),
      check('job_grant_target_check', sql`(${t.jobId} is null) <> (${t.clientId} is null)`),
      unique('job_grant_member_target_key').on(t.workspaceId, t.userId, t.jobId, t.clientId).nullsNotDistinct(),
      tenantPolicy('job_grant_tenant_isolation', t.workspaceId),
    ],
  )
  .enableRLS();
