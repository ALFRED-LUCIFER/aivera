import { outboxTable } from '@aivera/db/outbox';
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
  primaryKey,
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
import { CATALOGUE_STATUSES, type Labels } from '../domain/catalogue.ts';

export const jobs = pgSchema('jobs');

/**
 * Job scope (ADR-005 point 6): admins and recruiters run with `app.job_scope = 'all'`; hiring owners and interviewers
 * see a job only when it, or its client, is in their grants. Unset settings read as null, so no rows. The repository
 * filters by the same expression, so it is both layers.
 */
export const jobInScope = (id: AnyPgColumn, clientId: AnyPgColumn): SQL =>
  sql`(nullif(current_setting('app.job_scope', true), '') = 'all' or ${id} = any(nullif(current_setting('app.job_ids', true), '')::uuid[]) or ${clientId} = any(nullif(current_setting('app.client_ids', true), '')::uuid[]))`;

/**
 * A catalogue key (ADR-013 point 5): lower snake case, never one of the reserved answers. Validated by format, not by a
 * list, so a published job type or pack needs no migration; the application checks it against the catalogue.
 */
const isKey = (column: AnyPgColumn): SQL =>
  sql`${column} ~ '^[a-z][a-z0-9_]{2,47}$' and ${column} not in ('none', 'several', 'other')`;

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
      jobType: text('job_type').notNull(),
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
      check('job_type_key_check', isKey(t.jobType)),
      // The stage check must list exactly JOB_STAGES; changing it needs a new migration.
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
      // Who last sent it for approval, and the hiring owner's note when they returned it (AIV-P1-014).
      submittedBy: uuid('submitted_by'),
      returnNote: text('return_note'),
      // Bumped on every save of a version not yet approved, so a save of an older copy is refused (AIV-P1-013).
      revision: integer().notNull().default(0),
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
      // At most one open version per job: editing resumes it instead of starting another (AIV-P1-013).
      uniqueIndex('rubric_version_one_open_idx')
        .on(t.workspaceId, t.jobId)
        .where(sql`${t.status} in ('draft', 'awaiting_approval', 'returned')`),
      check('rubric_version_version_check', sql`${t.version} >= 1`),
      check(
        'rubric_version_status_check',
        sql`${t.status} in ('draft', 'awaiting_approval', 'approved', 'superseded', 'returned')`,
      ),
      check(
        'rubric_version_approval_check',
        sql`(${t.status} in ('approved', 'superseded')) = (${t.approvedBy} is not null and ${t.approvedAt} is not null)`,
      ),
      // RETURN_NOTE_MAX in domain/job.ts.
      check('rubric_version_return_note_check', sql`char_length(${t.returnNote}) between 1 and 1000`),
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
      packKey: text('pack_key'),
      packVersion: integer('pack_version'),
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
      check(
        'competency_origin_check',
        sql`${t.origin} in ('from_description', 'suggested_by_aivera', 'added_by_recruiter', 'domain_pack')`,
      ),
      check(
        'competency_domain_pack_check',
        sql`(${t.origin} = 'domain_pack') = (${t.packKey} is not null and ${t.packVersion} is not null)`,
      ),
      check('competency_pack_format_check', sql`${isKey(t.packKey)} and ${t.packVersion} >= 1`),
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
 * unpublished, so an old link can say "no longer open". `paused` hides every listing of a suspended workspace.
 */
export const publicJob = jobs
  .table(
    'public_job',
    {
      jobId: uuid('job_id').primaryKey(),
      workspaceId: uuid('workspace_id').notNull(),
      slug: text().notNull(),
      title: text().notNull(),
      jobType: text('job_type').notNull(),
      descriptor: text().notNull(),
      location: text(),
      payMinMinor: integer('pay_min_minor'),
      payMaxMinor: integer('pay_max_minor'),
      payCurrency: text('pay_currency'),
      competencies: jsonb().$type<PublicListing['competencies']>().notNull(),
      postedAt: timestamp('posted_at', { withTimezone: true }).notNull(),
      open: boolean().notNull(),
      // The workspace is suspended (AIV-P2-037): hidden from the candidate site until it is reactivated, `open` kept.
      paused: boolean().notNull().default(false),
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

// Events written in the same transaction as the change; the relay sends them to Service Bus (AIV-P0-014).
export const outbox = outboxTable(jobs);

/*
 * The catalogue (ADR-013): platform tables with no workspace_id and no tenant policy, since they hold no workspace,
 * candidate or personal data (tenancy.test.ts lists each). A published version never changes: the triggers of
 * migration 0016 refuse UPDATE, DELETE and TRUNCATE of its rows for every role. References between catalogue tables
 * are foreign keys, since this module owns them all.
 */

/** An operator's opaque identity user id, or the system actor that seeded version 1. Never a name or an email. */
const isActor = (column: AnyPgColumn): SQL =>
  sql`(${column} = 'system:seed' or ${column} ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')`;
const hasEnglish = (column: AnyPgColumn): SQL =>
  // coalesce: a missing `en` makes the test NULL, which a check constraint would pass.
  sql`coalesce(jsonb_typeof(${column}->'en') = 'string' and btrim(${column}->>'en') <> '', false)`;
const filled = (column: AnyPgColumn): SQL => sql`btrim(${column}) <> ''`;

export const catalogueVersion = jobs.table(
  'catalogue_version',
  {
    version: integer().primaryKey(),
    status: text({ enum: CATALOGUE_STATUSES }).notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    publishedBy: text('published_by'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    reason: text(),
  },
  (t) => [
    uniqueIndex('catalogue_version_one_draft_idx')
      .on(t.status)
      .where(sql`${t.status} = 'draft'`),
    check('catalogue_version_version_check', sql`${t.version} >= 1`),
    check('catalogue_version_status_check', sql`${t.status} in ('draft', 'published')`),
    check(
      'catalogue_version_published_check',
      sql`(${t.status} = 'published') = (${t.publishedBy} is not null and ${t.publishedAt} is not null and ${t.reason} is not null)`,
    ),
    check('catalogue_version_reason_check', sql`char_length(btrim(${t.reason})) >= 10`),
    check(
      'catalogue_version_actor_check',
      sql`${isActor(t.createdBy)} and (${t.publishedBy} is null or ${isActor(t.publishedBy)})`,
    ),
  ],
);

const version = () =>
  integer()
    .notNull()
    .references(() => catalogueVersion.version);

export const catalogueJobType = jobs.table(
  'catalogue_job_type',
  {
    version: version(),
    key: text().notNull(),
    position: integer().notNull(),
    label: jsonb().$type<Labels>().notNull(),
    evidence: jsonb().$type<Labels>().notNull(),
    starterCompetencies: text('starter_competencies').array().notNull(),
    retired: boolean().notNull().default(false),
  },
  (t) => [
    primaryKey({ name: 'catalogue_job_type_pkey', columns: [t.version, t.key] }),
    check('catalogue_job_type_key_check', isKey(t.key)),
    check('catalogue_job_type_label_check', sql`${hasEnglish(t.label)} and ${hasEnglish(t.evidence)}`),
    check('catalogue_job_type_starters_check', sql`cardinality(${t.starterCompetencies}) = 4`),
  ],
);

export const catalogueRegion = jobs.table(
  'catalogue_region',
  {
    version: version(),
    key: text().notNull(),
    position: integer().notNull(),
    label: jsonb().$type<Labels>().notNull(),
    retired: boolean().notNull().default(false),
  },
  (t) => [
    primaryKey({ name: 'catalogue_region_pkey', columns: [t.version, t.key] }),
    check('catalogue_region_key_check', isKey(t.key)),
    check('catalogue_region_label_check', hasEnglish(t.label)),
  ],
);

export const cataloguePack = jobs.table(
  'catalogue_pack',
  {
    version: version(),
    key: text().notNull(),
    position: integer().notNull(),
    label: jsonb().$type<Labels>().notNull(),
    retired: boolean().notNull().default(false),
  },
  (t) => [
    primaryKey({ name: 'catalogue_pack_pkey', columns: [t.version, t.key] }),
    check('catalogue_pack_key_check', isKey(t.key)),
    check('catalogue_pack_label_check', hasEnglish(t.label)),
  ],
);

/** What a pack competency and a regional hint share: a skill shown with evidence, never mandatory (ADR-013 point 11). */
const skill = () => ({
  version: version(),
  packKey: text('pack_key').notNull(),
  position: integer().notNull(),
  name: text().notNull(),
  meaning: text().notNull(),
  evidence: text().notNull(),
  level1: text('level_1').notNull(),
  level3: text('level_3').notNull(),
  level5: text('level_5').notNull(),
  // Job type keys: no foreign key reaches array elements, so the editor validates them (AIV-P2-045).
  appliesTo: text('applies_to').array().notNull(),
  levelNeeded: integer('level_needed').notNull(),
  type: text({ enum: ['desirable'] }).notNull(),
  retired: boolean().notNull().default(false),
});

type SkillColumns = Record<'name' | 'meaning' | 'evidence' | 'levelNeeded' | 'type', AnyPgColumn>;
const skillChecks = (table: string, t: SkillColumns) => [
  check(`${table}_text_check`, sql`${filled(t.name)} and ${filled(t.meaning)} and ${filled(t.evidence)}`),
  check(`${table}_level_check`, sql`${t.levelNeeded} in (2, 3)`),
  check(`${table}_type_check`, sql`${t.type} = 'desirable'`),
];

// At most 4 core competencies per job type per pack spans rows: the editor checks it (AIV-P2-045), a test checks v1.
export const cataloguePackCompetency = jobs.table(
  'catalogue_pack_competency',
  { ...skill(), core: text().array().notNull() },
  (t) => [
    primaryKey({ name: 'catalogue_pack_competency_pkey', columns: [t.version, t.packKey, t.position] }),
    foreignKey({
      name: 'catalogue_pack_competency_pack_fk',
      columns: [t.version, t.packKey],
      foreignColumns: [cataloguePack.version, cataloguePack.key],
    }),
    ...skillChecks('catalogue_pack_competency', t),
    check('catalogue_pack_competency_core_check', sql`${t.core} <@ ${t.appliesTo}`),
  ],
);

export const catalogueRegionalHint = jobs.table(
  'catalogue_regional_hint',
  { ...skill(), region: text().notNull() },
  (t) => [
    primaryKey({ name: 'catalogue_regional_hint_pkey', columns: [t.version, t.packKey, t.region, t.position] }),
    foreignKey({
      name: 'catalogue_regional_hint_pack_fk',
      columns: [t.version, t.packKey],
      foreignColumns: [cataloguePack.version, cataloguePack.key],
    }),
    foreignKey({
      name: 'catalogue_regional_hint_region_fk',
      columns: [t.version, t.region],
      foreignColumns: [catalogueRegion.version, catalogueRegion.key],
    }),
    ...skillChecks('catalogue_regional_hint', t),
  ],
);
