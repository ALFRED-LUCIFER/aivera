import { candidateAccountPolicy } from '@aivera/db/tenant-policy';
import { JOB_TYPES } from '@aivera/jobs';
import { sql } from 'drizzle-orm';
import { check, foreignKey, index, pgSchema, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { CONSENT_PURPOSES, LINK_REASONS } from '../domain/account.ts';

export const candidateAccounts = pgSchema('candidate_accounts');

// No workspace_id: the account belongs to the person (ADR-009). Full name is personal data: never log a row.
export const account = candidateAccounts
  .table(
    'account',
    {
      // The identity user's id (opaque, from @aivera/identity): one account per identity user.
      identityUserId: uuid('identity_user_id').primaryKey(),
      fullName: text('full_name'),
      workType: text('work_type', { enum: JOB_TYPES }),
      // From the injected clock (AGENTS.md 3.9).
      createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
      updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    },
    (t) => [
      // A job type key of the jobs catalogue, by format (ADR-013 points 5 and 7); the application checks the catalogue.
      check(
        'account_work_type_key_check',
        sql`${t.workType} ~ '^[a-z][a-z0-9_]{2,47}$' and ${t.workType} not in ('none', 'several', 'other')`,
      ),
      candidateAccountPolicy('account_owner_isolation', t.identityUserId),
    ],
  )
  .enableRLS();

// Headline and location are personal data.
export const profile = candidateAccounts
  .table(
    'profile',
    {
      accountId: uuid('account_id')
        .primaryKey()
        .references(() => account.identityUserId),
      headline: text(),
      location: text(),
    },
    (t) => [candidateAccountPolicy('profile_owner_isolation', t.accountId)],
  )
  .enableRLS();

export const consent = candidateAccounts
  .table(
    'consent',
    {
      id: uuid().primaryKey(),
      accountId: uuid('account_id')
        .notNull()
        .references(() => account.identityUserId),
      purpose: text({ enum: CONSENT_PURPOSES }).notNull(),
      // Opaque ids from workspaces and jobs; no foreign key across modules (ADR-004).
      workspaceId: uuid('workspace_id'),
      jobId: uuid('job_id'),
      grantedAt: timestamp('granted_at', { withTimezone: true }).notNull(),
      textVersion: text('text_version').notNull(),
      withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
    },
    (t) => [
      unique('consent_account_id_key').on(t.accountId, t.id),
      index('consent_account_granted_idx').on(t.accountId, t.grantedAt),
      // Must list exactly CONSENT_PURPOSES (domain/account.ts); changing it needs a new migration.
      check('consent_purpose_check', sql`${t.purpose} in ('apply_to_job', 'answer_evidence_request', 'cv_check')`),
      check('consent_text_version_check', sql`btrim(${t.textVersion}) <> ''`),
      // The domain's checkNewConsent rule: a workspace and job exactly when the consent reaches a workspace.
      check(
        'consent_target_check',
        sql`case when ${t.purpose} = 'cv_check' then ${t.workspaceId} is null and ${t.jobId} is null else ${t.workspaceId} is not null and ${t.jobId} is not null end`,
      ),
      check('consent_withdrawn_check', sql`${t.withdrawnAt} is null or ${t.withdrawnAt} >= ${t.grantedAt}`),
      candidateAccountPolicy('consent_owner_isolation', t.accountId),
    ],
  )
  .enableRLS();

export const workspaceLink = candidateAccounts
  .table(
    'workspace_link',
    {
      id: uuid().primaryKey(),
      accountId: uuid('account_id').notNull(),
      workspaceId: uuid('workspace_id').notNull(),
      // The workspace's candidates.person id (opaque; no foreign key across modules).
      workspaceCandidateId: uuid('workspace_candidate_id').notNull(),
      reason: text({ enum: LINK_REASONS }).notNull(),
      consentId: uuid('consent_id').notNull(),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    },
    (t) => [
      // Includes the account, so a link can only cite the same account's consent (FK checks skip RLS).
      foreignKey({
        name: 'workspace_link_consent_fk',
        columns: [t.accountId, t.consentId],
        foreignColumns: [consent.accountId, consent.id],
      }),
      unique('workspace_link_account_workspace_candidate_key').on(t.accountId, t.workspaceId, t.workspaceCandidateId),
      // Must list exactly LINK_REASONS (domain/account.ts); changing it needs a new migration.
      check('workspace_link_reason_check', sql`${t.reason} in ('applied', 'answered_evidence_request')`),
      candidateAccountPolicy('workspace_link_owner_isolation', t.accountId),
    ],
  )
  .enableRLS();
