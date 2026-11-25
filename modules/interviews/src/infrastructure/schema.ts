import { inboxTable, outboxTable } from '@credalent/db/outbox';
import { tenantPolicy } from '@credalent/db/tenant-policy';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { ROUNDS, STATUSES } from '../domain/interview.ts';
import { RECOMMENDATIONS, type ScorecardDraft } from '../domain/scorecard.ts';
import { FINDINGS, PROPOSAL_STATUSES, SUMMARY_STATUSES } from '../domain/summary.ts';

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

// A meeting summary a member pasted on an interview (AIV-P1-115). `text` is the interviewer's words about a candidate:
// it stays in this column and is never logged, sent in an event or copied to the audit log (AGENTS.md 1.2).
export const meetingSummaries = interviews
  .table(
    'meeting_summaries',
    {
      id: uuid().primaryKey(),
      workspaceId: uuid('workspace_id').notNull(),
      interviewId: uuid('interview_id').notNull(),
      authorUserId: uuid('author_user_id').notNull(),
      text: text().notNull(),
      status: text({ enum: SUMMARY_STATUSES }).notNull(),
      unusual: boolean().notNull(),
      promptVersion: text('prompt_version'),
      // From the injected clock (AGENTS.md 3.9).
      createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    },
    (t) => [
      unique('meeting_summaries_workspace_id_key').on(t.workspaceId, t.id),
      index('meeting_summaries_interview_idx').on(t.workspaceId, t.interviewId, t.createdAt),
      // A summary belongs to an interview of its own workspace and goes when the interview does.
      foreignKey({
        name: 'meeting_summaries_interview_fk',
        columns: [t.workspaceId, t.interviewId],
        foreignColumns: [interview.workspaceId, interview.id],
      }).onDelete('cascade'),
      // Must list exactly SUMMARY_STATUSES (domain/summary.ts); changing it needs a migration.
      check(
        'meeting_summaries_status_check',
        sql`${t.status} in ('analysing', 'waiting', 'failed', 'proposed', 'applied', 'declined')`,
      ),
      check('meeting_summaries_text_check', sql`char_length(${t.text}) between 1 and 12000`),
      tenantPolicy('meeting_summaries_tenant_isolation', t.workspaceId),
    ],
  )
  .enableRLS();

// What a summary proposes for each competency its interview tests: a proposal only. Nothing reads it to score; the
// assessment changes through its own command when a person applies (AGENTS.md 1.5).
export const summaryProposals = interviews
  .table(
    'summary_proposals',
    {
      summaryId: uuid('summary_id').notNull(),
      competencyId: uuid('competency_id').notNull(),
      workspaceId: uuid('workspace_id').notNull(),
      finding: text({ enum: FINDINGS }).notNull(),
      excerpt: text(),
      excerptStart: integer('excerpt_start'),
      excerptEnd: integer('excerpt_end'),
      reason: text(),
      proposedStrength: text('proposed_strength', { enum: ['claim', 'medium'] }),
      status: text({ enum: PROPOSAL_STATUSES }).notNull(),
    },
    (t) => [
      // One proposal a competency: a second analysis of the same summary can never add a second set.
      primaryKey({ columns: [t.summaryId, t.competencyId] }),
      foreignKey({
        name: 'summary_proposals_summary_fk',
        columns: [t.workspaceId, t.summaryId],
        foreignColumns: [meetingSummaries.workspaceId, meetingSummaries.id],
      }).onDelete('cascade'),
      // Must list exactly FINDINGS and PROPOSAL_STATUSES (domain/summary.ts); changing either needs a migration.
      check(
        'summary_proposals_finding_check',
        sql`${t.finding} in ('not_mentioned', 'not_shown', 'partly_shown', 'clearly_shown', 'strongly_shown')`,
      ),
      check('summary_proposals_status_check', sql`${t.status} in ('proposed', 'applied', 'declined')`),
      // SAFETY: never Strong: a summary is the interviewer's word (AGENTS.md 1.6).
      check('summary_proposals_strength_check', sql`${t.proposedStrength} in ('claim', 'medium')`),
      // A finding about the summary cites its excerpt; one the summary does not cover has none.
      check('summary_proposals_excerpt_check', sql`(${t.finding} = 'not_mentioned') = (${t.excerpt} is null)`),
      tenantPolicy('summary_proposals_tenant_isolation', t.workspaceId),
    ],
  )
  .enableRLS();

// Events written in the same transaction as the change; the relay sends them to Service Bus (AIV-P0-014).
export const outbox = outboxTable(interviews);

// Handled message ids of the summary analysis consumer (AIV-P0-015).
export const inbox = inboxTable(interviews);
