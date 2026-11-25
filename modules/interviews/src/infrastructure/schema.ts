import { outboxTable } from '@credalent/db/outbox';
import { tenantPolicy } from '@credalent/db/tenant-policy';
import { sql } from 'drizzle-orm';
import { check, foreignKey, index, jsonb, pgSchema, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { ROUNDS, STATUSES } from '../domain/interview.ts';
import { RECOMMENDATIONS, type ScorecardDraft } from '../domain/scorecard.ts';

export const interviews = pgSchema('interviews');

// application_id, job_id, candidate_id, interviewer_user_id and rubric_version_id are opaque ids of other modules'
// records: no foreign keys across modules (AGENTS.md 3.3).
export const interview = interviews
  .table(
    'interview',
    {
      id: uuid().primaryKey(),
      workspaceId: uuid('workspace_id').notNull(),
      applicationId: uuid('application_id').notNull(),
      jobId: uuid('job_id').notNull(),
      // shortcut: candidate_id and application_id are copied when the interview is created; a duplicate merge afterwards
      // (AIV-P1-018) leaves the merged person's id here, and, when both applied to the job, the emptied application's id.
      // Move both in the merge, as evidence's records are, when interviews show names (AIV-P2-002).
      candidateId: uuid('candidate_id').notNull(),
      round: text({ enum: ROUNDS }).notNull(),
      interviewerUserId: uuid('interviewer_user_id').notNull(),
      scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
      status: text({ enum: STATUSES }).notNull(),
      rubricVersionId: uuid('rubric_version_id').notNull(),
      competencyIds: uuid('competency_ids').array().notNull(),
      createdBy: uuid('created_by').notNull(),
      // From the injected clock (AGENTS.md 3.9).
      createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    },
    (t) => [
      unique('interview_workspace_id_key').on(t.workspaceId, t.id),
      // No one-per-application-and-round constraint: a panel round can hold several interviews, one per interviewer.
      index('interview_status_idx').on(t.workspaceId, t.status, t.scheduledAt),
      // Must list exactly ROUNDS and STATUSES (domain/interview.ts); changing either needs a migration.
      check('interview_round_check', sql`${t.round} in ('structured_screen', 'evidence_defence', 'panel')`),
      check(
        'interview_status_check',
        sql`${t.status} in ('to_schedule', 'scheduled', 'in_progress', 'scorecard_due', 'completed', 'cancelled')`,
      ),
      // A scheduled interview has a time; one still to schedule has none.
      check(
        'interview_scheduled_at_check',
        sql`(${t.status} <> 'scheduled' or ${t.scheduledAt} is not null) and (${t.status} <> 'to_schedule' or ${t.scheduledAt} is null)`,
      ),
      tenantPolicy('interview_tenant_isolation', t.workspaceId),
    ],
  )
  .enableRLS();

// An interviewer's unsubmitted scorecard (AIV-P2-004), one per interview: per competency a rating, a note and the marks
// on its questions, and a recommendation. Nothing reads it to score: the assessment changes only on submit (AIV-P2-006).
// No overall, communication, confidence or attitude column, here or inside `competencies` (domain/scorecard.ts).
export const scorecardDrafts = interviews
  .table(
    'scorecard_drafts',
    {
      interviewId: uuid('interview_id').primaryKey(),
      workspaceId: uuid('workspace_id').notNull(),
      competencies: jsonb().$type<ScorecardDraft['competencies']>().notNull(),
      recommendation: text({ enum: RECOMMENDATIONS }),
      updatedBy: uuid('updated_by').notNull(),
      // From the injected clock (AGENTS.md 3.9).
      updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    },
    (t) => [
      // A draft belongs to an interview of its own workspace and goes when the interview does.
      foreignKey({
        name: 'scorecard_drafts_interview_fk',
        columns: [t.workspaceId, t.interviewId],
        foreignColumns: [interview.workspaceId, interview.id],
      }).onDelete('cascade'),
      // Must list exactly RECOMMENDATIONS (domain/scorecard.ts); changing it needs a migration.
      check(
        'scorecard_drafts_recommendation_check',
        sql`${t.recommendation} in ('shortlist', 'more_evidence', 'not_recommended')`,
      ),
      tenantPolicy('scorecard_drafts_tenant_isolation', t.workspaceId),
    ],
  )
  .enableRLS();

// Events written in the same transaction as the change; the relay sends them to Service Bus (AIV-P0-014).
export const outbox = outboxTable(interviews);
