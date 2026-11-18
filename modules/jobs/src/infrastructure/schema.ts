import { tenantPolicy } from '@aivera/db/tenant-policy';
import { sql, type SQL } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgSchema,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import {
  COMPETENCY_ORIGINS,
  COMPETENCY_TYPES,
  JOB_STAGES,
  RUBRIC_STATUSES,
  type PublicListing,
} from '../domain/job.ts';
import { JOB_TYPES } from '../domain/job-types.ts';

export const jobs = pgSchema('jobs');

/**
 * Job scope (ADR-005 point 6): admins and recruiters run with `app.job_scope = 'all'`; hiring owners and interviewers
 * see a job only when it, or its client, is in their grants. Unset settings read as null, so no rows. The repository
 * filters by the same expression, so it is both layers.
 */
export const jobInScope = (id: AnyPgColumn, clientId: AnyPgColumn): SQL =>
  sql`(nullif(current_setting('app.job_scope', true), '') = 'all' or ${id} = any(nullif(current_setting('app.job_ids', true), '')::uuid[]) or ${clientId} = any(nullif(current_setting('app.client_ids', true), '')::uuid[]))`;

/** A restrictive policy, so it narrows the tenant policy instead of widening it. */
const restrictive = (name: string, matches: SQL) =>
  pgPolicy(name, { as: 'restrictive', for: 'all', using: matches, withCheck: matches });

export const job = jobs
  .table(
    'job',
    {
      id: uuid().primaryKey(),
      workspaceId: uuid('workspace_id').notNull(),
      title: text().notNull(),
      jobType: text('job_type', { enum: JOB_TYPES }).notNull(),
      description: text().notNull(),
      team: text(),
      // Opaque id of a workspaces.client (ADR-004 6: no foreign key across modules); null is the team's own job.
      clientId: uuid('client_id'),
      location: text(),
      // Opaque user id of a workspaces member.
      hiringOwnerUserId: uuid('hiring_owner_user_id'),
      stage: text({ enum: JOB_STAGES }).notNull(),
      published: boolean().notNull(),
      // How the candidate site names the employer; never the client's name (AIV-P1-015).
      publicDescriptor: text('public_descriptor'),
      publishedAt: timestamp('published_at', { withTimezone: true }),
      payMinMinor: integer('pay_min_minor'),
      payMaxMinor: integer('pay_max_minor'),
      payCurrency: text('pay_currency'),
      // No default: every insert states it (AGENTS.md 1.1).
      synthetic: boolean().notNull(),
      createdBy: uuid('created_by').notNull(),
      // From the injected clock (AGENTS.md 3.9).
      createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    },
    (t) => [
      unique('job_workspace_id_key').on(t.workspaceId, t.id),
      index('job_workspace_created_idx').on(t.workspaceId, t.createdAt, t.id),
      check('job_title_check', sql`btrim(${t.title}) <> ''`),
      // The check constraints must list exactly JOB_TYPES and the domain's enums; changing one needs a new migration.
      check(
        'job_type_check',
        sql`${t.jobType} in ('software_engineering', 'qa_test_automation', 'ai_llm_engineering', 'forward_deployed_engineering', 'data_ml', 'devops_sre', 'product_management', 'product_design', 'sales', 'technical_writing_support')`,
      ),
      check(
        'job_stage_check',
        sql`${t.stage} in ('defining_rubric', 'collecting_evidence', 'round_1', 'decision', 'closed')`,
      ),
      check(
        'job_pay_band_check',
        sql`(${t.payMinMinor} is null and ${t.payMaxMinor} is null and ${t.payCurrency} is null) or (0 <= ${t.payMinMinor} and ${t.payMinMinor} <= ${t.payMaxMinor} and ${t.payCurrency} ~ '^[A-Z]{3}$')`,
      ),
      // A published job always has its descriptor and publish time; unpublishing keeps both. 80: PUBLIC_DESCRIPTOR_MAX.
      check(
        'job_publication_check',
        sql`not ${t.published} or (coalesce(btrim(${t.publicDescriptor}), '') <> '' and char_length(${t.publicDescriptor}) <= 80 and ${t.publishedAt} is not null)`,
      ),
      tenantPolicy('job_tenant_isolation', t.workspaceId),
      restrictive('job_scope', jobInScope(t.id, t.clientId)),
    ],
  )
  .enableRLS();

export const rubricVersion = jobs
  .table(
    'rubric_version',
    {
      id: uuid().primaryKey(),
      workspaceId: uuid('workspace_id').notNull(),
      jobId: uuid('job_id').notNull(),
      version: integer().notNull(),
      status: text({ enum: RUBRIC_STATUSES }).notNull(),
      successStatement: text('success_statement').notNull(),
      changeNote: text('change_note'),
      createdBy: uuid('created_by').notNull(),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
      approvedBy: uuid('approved_by'),
      approvedAt: timestamp('approved_at', { withTimezone: true }),
    },
    (t) => [
      // Includes the workspace, so a version cannot hang off another workspace's job (key checks skip RLS).
      foreignKey({
        name: 'rubric_version_job_fk',
        columns: [t.workspaceId, t.jobId],
        foreignColumns: [job.workspaceId, job.id],
      }),
      unique('rubric_version_workspace_id_key').on(t.workspaceId, t.id),
      unique('rubric_version_job_version_key').on(t.workspaceId, t.jobId, t.version),
      // At most one approved version per job; approving supersedes the previous one first.
      uniqueIndex('rubric_version_one_approved_idx')
        .on(t.workspaceId, t.jobId)
        .where(sql`${t.status} = 'approved'`),
      check('rubric_version_version_check', sql`${t.version} >= 1`),
      check(
        'rubric_version_status_check',
        sql`${t.status} in ('draft', 'awaiting_approval', 'approved', 'superseded', 'returned')`,
      ),
      check(
        'rubric_version_approval_check',
        sql`(${t.status} in ('approved', 'superseded')) = (${t.approvedBy} is not null and ${t.approvedAt} is not null)`,
      ),
      tenantPolicy('rubric_version_tenant_isolation', t.workspaceId),
      // Visible only through a job the transaction may see, so job scope reaches the rubric too.
      restrictive('rubric_version_job_scope', sql`exists (select 1 from ${job} where ${job.id} = ${t.jobId})`),
    ],
  )
  .enableRLS();

export const competency = jobs
  .table(
    'competency',
    {
      id: uuid().primaryKey(),
      workspaceId: uuid('workspace_id').notNull(),
      rubricVersionId: uuid('rubric_version_id').notNull(),
      name: text().notNull(),
      evidenceExpected: text('evidence_expected').notNull(),
      weightPercent: integer('weight_percent').notNull(),
      levelNeeded: integer('level_needed').notNull(),
      type: text({ enum: COMPETENCY_TYPES }).notNull(),
      origin: text({ enum: COMPETENCY_ORIGINS }).notNull(),
      position: integer().notNull(),
    },
    (t) => [
      foreignKey({
        name: 'competency_rubric_version_fk',
        columns: [t.workspaceId, t.rubricVersionId],
        foreignColumns: [rubricVersion.workspaceId, rubricVersion.id],
      }),
      unique('competency_version_position_key').on(t.workspaceId, t.rubricVersionId, t.position),
      check('competency_weight_check', sql`${t.weightPercent} between 1 and 100`),
      check('competency_level_check', sql`${t.levelNeeded} between 1 and 5`),
      check('competency_type_check', sql`${t.type} in ('mandatory', 'desirable')`),
      check('competency_origin_check', sql`${t.origin} in ('from_description', 'suggested_by_aivera')`),
      tenantPolicy('competency_tenant_isolation', t.workspaceId),
      restrictive(
        'competency_job_scope',
        sql`exists (select 1 from ${rubricVersion} where ${rubricVersion.id} = ${t.rubricVersionId})`,
      ),
    ],
  )
  .enableRLS();

/**
 * The candidate site's read model (AIV-P3-002): one row per job ever published, written in the publishing
 * transaction. Public reads run as aivera_public, which may select only the public columns (grants.sql) and, through
 * `public_job_public_read`, every row; the workspace and job ids stay for the writers. `open` is false once
 * unpublished, so an old link can say "no longer open".
 */
export const publicJob = jobs
  .table(
    'public_job',
    {
      jobId: uuid('job_id').primaryKey(),
      workspaceId: uuid('workspace_id').notNull(),
      slug: text().notNull(),
      title: text().notNull(),
      jobType: text('job_type', { enum: JOB_TYPES }).notNull(),
      descriptor: text().notNull(),
      location: text(),
      payMinMinor: integer('pay_min_minor'),
      payMaxMinor: integer('pay_max_minor'),
      payCurrency: text('pay_currency'),
      competencies: jsonb().$type<PublicListing['competencies']>().notNull(),
      postedAt: timestamp('posted_at', { withTimezone: true }).notNull(),
      open: boolean().notNull(),
    },
    (t) => [
      foreignKey({
        name: 'public_job_job_fk',
        columns: [t.workspaceId, t.jobId],
        foreignColumns: [job.workspaceId, job.id],
      }).onDelete('cascade'),
      unique('public_job_slug_key').on(t.slug),
      index('public_job_open_posted_idx').on(t.open, t.postedAt),
      tenantPolicy('public_job_tenant_isolation', t.workspaceId),
      // The one non-tenant policy in the schema: reads only, and only as the public role (tenancy.test.ts allows
      // exactly this one). Matching on current_user, not `TO aivera_public`, so the migration needs no such role.
      pgPolicy('public_job_public_read', {
        as: 'permissive',
        for: 'select',
        using: sql`current_user = 'aivera_public'`,
      }),
    ],
  )
  .enableRLS();
