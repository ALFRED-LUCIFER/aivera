import { inboxTable } from '@credalent/db/outbox';
import { tenantPolicy } from '@credalent/db/tenant-policy';
import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgSchema, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { CompetencyResult } from '../domain/assess.ts';

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

// Handled message ids of the assessment consumers (AIV-P0-015).
export const inbox = inboxTable(assessment);
