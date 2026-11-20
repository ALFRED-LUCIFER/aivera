import { outboxTable } from '@credalent/db/outbox';
import { tenantPolicy } from '@credalent/db/tenant-policy';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { PROVENANCES, SOURCE_KINDS, STRENGTHS } from '../domain/evidence.ts';

export const evidence = pgSchema('evidence');

const tz = { withTimezone: true } as const;

// label, url, check_method and every item's text are candidate personal data (PERSONAL_DATA_FIELDS): never log a row.
export const source = evidence
  .table(
    'source',
    {
      id: uuid().primaryKey(),
      workspaceId: uuid('workspace_id').notNull(),
      // The candidates module's person id: an opaque id, no foreign key across modules (AGENTS.md 3.3).
      candidateId: uuid('candidate_id').notNull(),
      kind: text({ enum: SOURCE_KINDS }).notNull(),
      label: text().notNull(),
      url: text(),
      blobFileId: text('blob_file_id'),
      capturedAt: timestamp('captured_at', tz).notNull(),
      checkedAt: timestamp('checked_at', tz),
      checkMethod: text('check_method'),
      // No default: every insert states it (AGENTS.md 1.1).
      synthetic: boolean().notNull(),
      createdAt: timestamp('created_at', tz).notNull(),
    },
    (t) => [
      unique('source_workspace_candidate_key').on(t.workspaceId, t.id, t.candidateId),
      // Must list exactly SOURCE_KINDS (domain/evidence.ts); changing it needs a new migration.
      check(
        'source_kind_check',
        sql`${t.kind} in ('cv', 'repository', 'document', 'shipped_product', 'reference_call', 'portal_submission', 'interview_note')`,
      ),
      check('source_url_check', sql`${t.url} is null or ${t.url} like 'https://%'`),
      tenantPolicy('source_tenant_isolation', t.workspaceId),
    ],
  )
  .enableRLS();

export const item = evidence
  .table(
    'item',
    {
      id: uuid().primaryKey(),
      workspaceId: uuid('workspace_id').notNull(),
      sourceId: uuid('source_id').notNull(),
      candidateId: uuid('candidate_id').notNull(),
      excerpt: text().notNull(),
      excerptSpan: text('excerpt_span'),
      provenance: text({ enum: PROVENANCES }).notNull(),
      strength: text({ enum: STRENGTHS }).notNull(),
      limit: text('limit_statement').notNull(),
      synthetic: boolean().notNull(),
      createdAt: timestamp('created_at', tz).notNull(),
    },
    (t) => [
      // Includes the workspace and candidate, so an item cannot cite another workspace's or candidate's source.
      foreignKey({
        name: 'item_source_fk',
        columns: [t.workspaceId, t.sourceId, t.candidateId],
        foreignColumns: [source.workspaceId, source.id, source.candidateId],
      }),
      unique('item_workspace_id_key').on(t.workspaceId, t.id),
      index('item_candidate_idx').on(t.workspaceId, t.candidateId, t.createdAt, t.id),
      // Must list exactly PROVENANCES and STRENGTHS (domain/evidence.ts); changing them needs a new migration.
      check(
        'item_provenance_check',
        sql`${t.provenance} in ('corroborated', 'submitted', 'claim', 'contradictory', 'awaiting-defence')`,
      ),
      check('item_strength_check', sql`${t.strength} in ('strong', 'medium', 'supporting', 'claim')`),
      // The domain's checkItem rules again, so no write path can store a claim above Supporting or an item with no limit.
      check(
        'item_claim_strength_check',
        sql`${t.provenance} not in ('claim', 'awaiting-defence') or ${t.strength} in ('supporting', 'claim')`,
      ),
      check('item_limit_check', sql`btrim(${t.limit}) <> ''`),
      check('item_excerpt_check', sql`btrim(${t.excerpt}) <> ''`),
      tenantPolicy('item_tenant_isolation', t.workspaceId),
    ],
  )
  .enableRLS();

export const competencyLink = evidence
  .table(
    'competency_link',
    {
      workspaceId: uuid('workspace_id').notNull(),
      itemId: uuid('item_id').notNull(),
      // The jobs module's job and competency ids: opaque, no foreign key across modules.
      jobId: uuid('job_id').notNull(),
      competencyId: uuid('competency_id').notNull(),
    },
    (t) => [
      primaryKey({ name: 'competency_link_pkey', columns: [t.workspaceId, t.itemId, t.competencyId] }),
      foreignKey({
        name: 'competency_link_item_fk',
        columns: [t.workspaceId, t.itemId],
        foreignColumns: [item.workspaceId, item.id],
      }),
      index('competency_link_job_idx').on(t.workspaceId, t.jobId),
      tenantPolicy('competency_link_tenant_isolation', t.workspaceId),
    ],
  )
  .enableRLS();

// Events written in the same transaction as the change; the relay sends them to Service Bus (AIV-P0-014).
export const outbox = outboxTable(evidence);
