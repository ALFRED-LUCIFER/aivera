import { inboxTable, outboxTable } from '@credalent/db/outbox';
import { tenantPolicy } from '@credalent/db/tenant-policy';
import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, jsonb, pgSchema, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { SOURCES, STAGES } from '../domain/application.ts';
import { SHEET_STATUSES, type SheetMapping, type SheetRow, type SheetUnreadable } from '../domain/sheet.ts';

export const intake = pgSchema('intake');

// person_id and job_id are opaque ids of other modules' records: no foreign keys across modules (AGENTS.md 3.3).
export const application = intake
  .table(
    'application',
    {
      id: uuid().primaryKey(),
      workspaceId: uuid('workspace_id').notNull(),
      personId: uuid('person_id').notNull(),
      jobId: uuid('job_id').notNull(),
      stage: text({ enum: STAGES }).notNull(),
      // From the injected clock (AGENTS.md 3.9).
      receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
      submittedToClientAt: timestamp('submitted_to_client_at', { withTimezone: true }),
    },
    (t) => [
      unique('application_workspace_id_key').on(t.workspaceId, t.id),
      // One application per person per job: a second arrival adds a source instead.
      unique('application_person_job_key').on(t.workspaceId, t.personId, t.jobId),
      index('application_job_idx').on(t.workspaceId, t.jobId, t.receivedAt),
      // Must list exactly STAGES (domain/application.ts), which has no rejected stage; changing it needs a migration.
      check(
        'application_stage_check',
        sql`${t.stage} in ('new', 'first_pass_done', 'assessing', 'interview', 'in_process', 'in_pool', 'withdrawn', 'round2_shortlist', 'not_advanced')`,
      ),
      tenantPolicy('application_tenant_isolation', t.workspaceId),
    ],
  )
  .enableRLS();

// One confirmation per save of "Add applicants" (AIV-P1-104). job_id and confirmed_by are opaque ids of other modules.
export const importBatch = intake
  .table(
    'import_batches',
    {
      id: uuid().primaryKey(),
      workspaceId: uuid('workspace_id').notNull(),
      jobId: uuid('job_id').notNull(),
      confirmedBy: uuid('confirmed_by').notNull(),
      confirmedAt: timestamp('confirmed_at', { withTimezone: true }).notNull(),
      wordingKey: text('wording_key').notNull(),
      wordingVersion: text('wording_version').notNull(),
      cvs: integer().notNull(),
    },
    (t) => [
      unique('import_batches_workspace_id_key').on(t.workspaceId, t.id),
      check('import_batches_cvs_check', sql`${t.cvs} >= 1`),
      tenantPolicy('import_batches_tenant_isolation', t.workspaceId),
    ],
  )
  .enableRLS();

// links and github_login are candidate personal data (PERSONAL_DATA_FIELDS): never log a row.
export const applicationSource = intake
  .table(
    'application_source',
    {
      id: uuid().primaryKey(),
      workspaceId: uuid('workspace_id').notNull(),
      applicationId: uuid('application_id').notNull(),
      source: text({ enum: SOURCES }).notNull(),
      receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
      fileIds: uuid('file_ids').array().notNull(),
      links: text().array().notNull(),
      githubLogin: text('github_login'),
      // Null for an arrival with no confirmed batch; the database keeps a set value pointing at this workspace's batch.
      batchId: uuid('batch_id'),
    },
    (t) => [
      foreignKey({
        name: 'application_source_batch_fk',
        columns: [t.workspaceId, t.batchId],
        foreignColumns: [importBatch.workspaceId, importBatch.id],
      }),
      // Includes the workspace, so a source cannot point at another workspace's application (FK checks skip RLS).
      foreignKey({
        name: 'application_source_application_fk',
        columns: [t.workspaceId, t.applicationId],
        foreignColumns: [application.workspaceId, application.id],
      }),
      index('application_source_application_idx').on(t.workspaceId, t.applicationId),
      // Must list exactly SOURCES (domain/application.ts); changing it needs a new migration.
      check(
        'application_source_source_check',
        sql`${t.source} in ('linkedin', 'careers_page', 'referral', 'email', 'whatsapp', 'recruiter', 'spreadsheet')`,
      ),
      tenantPolicy('application_source_tenant_isolation', t.workspaceId),
    ],
  )
  .enableRLS();

// A CSV or Excel import in progress (AIV-P1-103), owned by the member who started it. file_id, job_id and created_by are
// opaque ids of other modules. headers and rows are candidate personal data (the sheet's values): never log a row.
export const sheetImport = intake
  .table(
    'sheet_imports',
    {
      id: uuid().primaryKey(),
      workspaceId: uuid('workspace_id').notNull(),
      jobId: uuid('job_id').notNull(),
      fileId: uuid('file_id').notNull(),
      createdBy: uuid('created_by').notNull(),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
      status: text({ enum: SHEET_STATUSES }).notNull(),
      problem: text().$type<SheetUnreadable>(),
      headers: text().array(),
      mapping: jsonb().$type<SheetMapping>(),
      rows: jsonb().$type<SheetRow[]>(),
    },
    (t) => [
      // Must list exactly SHEET_STATUSES (domain/sheet.ts); changing it needs a new migration.
      check(
        'sheet_imports_status_check',
        sql`${t.status} in ('reading', 'mapping', 'fetching', 'ready', 'unreadable', 'added')`,
      ),
      tenantPolicy('sheet_imports_tenant_isolation', t.workspaceId),
    ],
  )
  .enableRLS();

// Events written in the same transaction as the change; the relay sends them to Service Bus (AIV-P0-014).
export const outbox = outboxTable(intake);

// One row per handled message and consumer: the DecisionsRecorded.v1 stage update runs once per message (AIV-P2-012).
export const inbox = inboxTable(intake);
