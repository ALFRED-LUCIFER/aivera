import { outboxTable } from '@credalent/db/outbox';
import { candidateAccountPolicy, tenantPolicy } from '@credalent/db/tenant-policy';
import { sql } from 'drizzle-orm';
import { check, integer, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { FILE_STATUSES, PURPOSES } from '../domain/files.ts';

export const files = pgSchema('files');

const tz = { withTimezone: true } as const;

// The blob path holds opaque ids only. The file name can name the candidate (AGENTS.md 1.2): it stays in this row, shown
// on screen to admins and recruiters until a name is read from the CV (AIV-P1-165), never in a log, URL or blob path.
export const file = files
  .table(
    'file',
    {
      id: uuid().primaryKey(),
      // Exactly one owner: a workspace, or for a candidate-site upload the candidate account (ADR-009).
      workspaceId: uuid('workspace_id'),
      candidateAccountId: uuid('candidate_account_id'),
      purpose: text({ enum: PURPOSES }).notNull(),
      contentType: text('content_type').notNull(),
      // Null for files uploaded before AIV-P1-165.
      fileName: text('file_name'),
      sizeBytes: integer('size_bytes').notNull(),
      sha256: text(),
      status: text({ enum: FILE_STATUSES }).notNull(),
      // `<container>/<blob name>`: in uploads-quarantine until the scan, then in cv or evidence.
      blobPath: text('blob_path').notNull(),
      // The identity user id of whoever asked for the upload.
      uploadedBy: uuid('uploaded_by').notNull(),
      createdAt: timestamp('created_at', tz).notNull(),
    },
    (t) => [
      // A workspace file is never also an account's, so the account policy below cannot reach a workspace's row.
      check('file_one_owner_check', sql`num_nonnulls(${t.workspaceId}, ${t.candidateAccountId}) = 1`),
      // Must list exactly PURPOSES and FILE_STATUSES (domain/files.ts); changing them needs a new migration.
      check('file_purpose_check', sql`${t.purpose} in ('cv', 'evidence', 'portal', 'candidate_sheet')`),
      check('file_status_check', sql`${t.status} in ('pending', 'clean', 'infected', 'rejected')`),
      check('file_size_check', sql`${t.sizeBytes} > 0`),
      // Permissive policies are OR-ed: a row is reached in its workspace's scope or in its account's, never both.
      tenantPolicy('file_tenant_isolation', t.workspaceId),
      candidateAccountPolicy('file_owner_isolation', t.candidateAccountId),
    ],
  )
  .enableRLS();

// FileClean.v1 and FileRejected.v1, written in the transaction that settles a workspace's file (AIV-P0-014).
export const outbox = outboxTable(files);
