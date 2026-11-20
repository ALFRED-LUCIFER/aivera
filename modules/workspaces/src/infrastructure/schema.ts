import { tenantPolicy } from '@credalent/db/tenant-policy';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { MEMBER_STATUSES, ROLES, WORKSPACE_STATUSES, WORKSPACE_TYPES } from '../domain/workspace.ts';

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
      // Set at sign-up (AIV-P2-039), then changed only by an operator (AIV-P2-037); request contexts refuse new work
      // unless it is active.
      status: text({ enum: WORKSPACE_STATUSES }).notNull().default('active'),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
      // An operator's daily AI token budget for this workspace (AIV-P2-038); null means the platform default.
      aiDailyTokenBudget: integer('ai_daily_token_budget'),
    },
    (t) => [
      check('workspace_type_check', sql`${t.type} in ('in_house', 'agency')`),
      // Must match AI_DAILY_TOKEN_BUDGET's min and max (domain/workspace.ts); changing them needs a new migration.
      check(
        'workspace_ai_daily_token_budget_check',
        sql`${t.aiDailyTokenBudget} is null or ${t.aiDailyTokenBudget} between 100000 and 10000000`,
      ),
      // Must list exactly WORKSPACE_STATUSES (domain/workspace.ts); changing it needs a new migration.
      check('workspace_status_check', sql`${t.status} in ('active', 'suspended', 'pending_approval', 'rejected')`),
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
      // The job title shown in the app ("CPO, Payments"), from the invitation (AIV-P1-003); null when none was given.
      title: text(),
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
// Deleting a workspace clears these rows first (deleteWorkspace, used only by the synthetic purge).
export const activeWorkspace = workspaces.table('active_workspace', {
  userId: uuid('user_id').primaryKey(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspace.id),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// The platform list of workspaces for the operator console (ADR-012 point 6): the opaque id and created date only,
// nothing a tenant wrote, so like active_workspace it has no tenant policy (tenancy.test.ts GLOBAL_TABLES). Written with
// the workspace (insertWorkspace) and deleted with it (deleteWorkspace). Each workspace's facts are read inside
// withWorkspace(<that workspace>), under its tenant policies.
export const directory = workspaces.table('directory', {
  workspaceId: uuid('workspace_id')
    .primaryKey()
    .references(() => workspace.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

// An agency's client (ADR-005 point 6). Only an agency workspace adds them (enforced in the use case under a lock on the
// workspace row). Never deleted, only archived, so old jobs and audit entries keep resolving; the synthetic demo purge is the exception.
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

// An invitation to join the workspace (AIV-P1-003). Only the SHA-256 of the link's token is stored. Job ids are opaque
// jobs-module ids; accepting turns them and the client ids into job grants. Kept after it is accepted or revoked, so
// the audit trail resolves.
export const invitation = workspaces
  .table(
    'invitation',
    {
      id: uuid().primaryKey(),
      workspaceId: uuid('workspace_id')
        .notNull()
        .references(() => workspace.id),
      email: text().notNull(),
      role: text({ enum: ROLES }).notNull(),
      title: text(),
      jobIds: uuid('job_ids')
        .array()
        .notNull()
        .default(sql`'{}'`),
      clientIds: uuid('client_ids')
        .array()
        .notNull()
        .default(sql`'{}'`),
      tokenHash: text('token_hash').notNull().unique(),
      invitedBy: uuid('invited_by').notNull(),
      expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
      acceptedAt: timestamp('accepted_at', { withTimezone: true }),
      revokedAt: timestamp('revoked_at', { withTimezone: true }),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      check('invitation_role_check', sql`${t.role} in ('admin', 'recruiter', 'hiring_owner', 'interviewer')`),
      // Hiring owners and interviewers name at least one job or client; admins and recruiters none (assertAccessFitsRole).
      check(
        'invitation_access_check',
        sql`(${t.role} in ('hiring_owner', 'interviewer')) = (cardinality(${t.jobIds}) + cardinality(${t.clientIds}) > 0)`,
      ),
      tenantPolicy('invitation_tenant_isolation', t.workspaceId),
    ],
  )
  .enableRLS();

// Input plus output AI tokens a workspace spent on one UTC day (AIV-P0-033): the store behind @credalent/ai's daily
// budget, shared by every web replica and the worker. Read and written only through AiTokenBudget (ADR-006 point 2).
export const aiTokenUsage = workspaces
  .table(
    'ai_token_usage',
    {
      workspaceId: uuid('workspace_id')
        .notNull()
        .references(() => workspace.id),
      usageDay: date('usage_day', { mode: 'string' }).notNull(),
      tokens: bigint({ mode: 'number' }).notNull(),
    },
    (t) => [
      primaryKey({ columns: [t.workspaceId, t.usageDay] }),
      check('ai_token_usage_tokens_check', sql`${t.tokens} >= 0`),
      tenantPolicy('ai_token_usage_tenant_isolation', t.workspaceId),
    ],
  )
  .enableRLS();

// A workspace's settings (AIV-P1-051): one row, written on the first change; no row means every default. The value is
// validated by settingsSchema (domain/settings.ts) on every write and read.
export const settings = workspaces
  .table(
    'settings',
    {
      workspaceId: uuid('workspace_id')
        .primaryKey()
        .references(() => workspace.id),
      value: jsonb().$type<Record<string, unknown>>().notNull(),
      updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
      // Opaque id of the identity module's user who last changed a value.
      updatedBy: uuid('updated_by').notNull(),
    },
    (t) => [
      check('settings_value_check', sql`jsonb_typeof(${t.value}) = 'object'`),
      tenantPolicy('settings_tenant_isolation', t.workspaceId),
    ],
  )
  .enableRLS();
