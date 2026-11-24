import { inboxTable } from '@credalent/db/outbox';
import { tenantPolicy } from '@credalent/db/tenant-policy';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  pgSchema,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { CompetencyResult } from '../domain/assess.ts';
import type { ExplanationStatement } from '../domain/explain.ts';

export const assessment = pgSchema('assessment');

// One row per assessment that changed something: the score history of a candidate for a job. Append-only (0001).
// Ids, levels and numbers only, so a row holds no candidate personal data.
export const result = assessment
  .table(
    'result',
    {
      id: uuid().primaryKey(),
      workspaceId: uuid('workspace_id').notNull(),
      // Opaque ids of the candidates and jobs modules: no foreign key across modules (AGENTS.md 3.3).
      candidateId: uuid('candidate_id').notNull(),
      jobId: uuid('job_id').notNull(),
      rubricVersionId: uuid('rubric_version_id').notNull(),
      backedScore: smallint('backed_score').notNull(),
      upperBound: smallint('upper_bound').notNull(),
      meetsNeed: smallint('meets_need').notNull(),
      competencyCount: smallint('competency_count').notNull(),
      missingCritical: jsonb('missing_critical').$type<string[]>().notNull(),
      confidence: text({ enum: ['High', 'Medium', 'Low'] }).notNull(),
      competencies: jsonb().$type<CompetencyResult[]>().notNull(),
      assessedAt: timestamp('assessed_at', { withTimezone: true }).notNull(),
    },
    (t) => [
      index('result_candidate_job_idx').on(t.workspaceId, t.candidateId, t.jobId, t.assessedAt),
      // The ranking reads a job's results (AIV-P1-031).
      index('result_job_idx').on(t.workspaceId, t.jobId, t.assessedAt),
      // The domain's guarantees again, so no write path can store a backed score above its range.
      check(
        'result_scores_check',
        sql`${t.backedScore} between 0 and 100 and ${t.upperBound} between ${t.backedScore} and 100`,
      ),
      check('result_meets_need_check', sql`${t.meetsNeed} between 0 and ${t.competencyCount}`),
      check('result_confidence_check', sql`${t.confidence} in ('High', 'Medium', 'Low')`),
      tenantPolicy('result_tenant_isolation', t.workspaceId),
    ],
  )
  .enableRLS();

// The AI explanation of a stored result (AIV-P1-033), cached per result id and prompt version: a new result or a new
// prompt writes a new row. Holds the statements with their quotes of the candidate's evidence, so it stays in the database
// (AGENTS.md 1.2); deleting a result deletes its explanations (erasure, AIV-P3-014). Only AI answers are stored; the template is cheap and never cached.
export const explanation = assessment
  .table(
    'explanation',
    {
      resultId: uuid('result_id')
        .notNull()
        .references(() => result.id, { onDelete: 'cascade' }),
      promptVersion: text('prompt_version').notNull(),
      workspaceId: uuid('workspace_id').notNull(),
      statements: jsonb().$type<ExplanationStatement[]>().notNull(),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    },
    (t) => [
      primaryKey({ columns: [t.resultId, t.promptVersion] }),
      tenantPolicy('explanation_tenant_isolation', t.workspaceId),
    ],
  )
  .enableRLS();

// A person's applied interview-based change to one competency (AIV-P1-117): every later assessment re-applies it, so
// the interviewer's word stands until another interview changes it. Append-only (0008_force_rls_interview_change). `reason` is the person's own
// words about a candidate, so it stays here and in the audit note (AGENTS.md 1.2); a result's erasure deletes its changes.
export const interviewChange = assessment
  .table(
    'interview_change',
    {
      id: uuid().primaryKey(),
      workspaceId: uuid('workspace_id').notNull(),
      candidateId: uuid('candidate_id').notNull(),
      jobId: uuid('job_id').notNull(),
      // The snapshot stored with the change.
      resultId: uuid('result_id')
        .notNull()
        .references(() => result.id, { onDelete: 'cascade' }),
      competencyId: uuid('competency_id').notNull(),
      // The interviews module's opaque interview id: the source the change cites.
      sourceId: uuid('source_id').notNull(),
      strength: text({ enum: ['claim', 'medium', 'strong'] }).notNull(),
      level: smallint().notNull(),
      // The evidence items a `claim` change weakens.
      itemIds: jsonb('item_ids').$type<string[]>().notNull(),
      reason: text().notNull(),
      appliedBy: uuid('applied_by').notNull(),
      appliedAt: timestamp('applied_at', { withTimezone: true }).notNull(),
      idempotencyKey: uuid('idempotency_key').notNull(),
      // The preview the person confirmed: a retry under the same key must carry the same one.
      previewId: text('preview_id').notNull(),
    },
    (t) => [
      index('interview_change_candidate_job_idx').on(t.workspaceId, t.candidateId, t.jobId, t.appliedAt),
      // One apply per idempotency key: a retry can never store a second set of changes.
      uniqueIndex('interview_change_idempotency_idx').on(t.workspaceId, t.idempotencyKey, t.competencyId),
      check('interview_change_strength_check', sql`${t.strength} in ('claim', 'medium', 'strong')`),
      check('interview_change_level_check', sql`${t.level} between 0 and 5`),
      check('interview_change_reason_check', sql`length(trim(${t.reason})) > 0`),
      tenantPolicy('interview_change_tenant_isolation', t.workspaceId),
    ],
  )
  .enableRLS();

// Handled message ids of the assessment consumers (AIV-P0-015).
export const inbox = inboxTable(assessment);
