import { inboxTable, outboxTable } from '@credalent/db/outbox';
import { tenantPolicy } from '@credalent/db/tenant-policy';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { CV_PARSE_STATUSES, NOTE_REASONS } from '../domain/cv.ts';
import { DOCUMENT_READ_STATUSES } from '../domain/document.ts';
import { PROVENANCES, SOURCE_KINDS, STRENGTHS } from '../domain/evidence.ts';
import { DUPLICATE_RESOLUTIONS } from '../domain/fingerprint.ts';
import { GAP_KINDS, type StoredChange } from '../domain/mapping.ts';
import { REPOSITORY_READ_STATUSES } from '../domain/repository.ts';
import { DEFAULT_FOLLOW_UP, REQUEST_STATUSES } from '../domain/request.ts';
import {
  type Citation,
  COVERAGE_GAPS,
  GRADE_REASONS,
  SIGNAL_KINDS,
  SIGNAL_WEIGHTS,
  SKILL_GRADES,
} from '../domain/skill-signals/classify.ts';

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
      // The SimHash of the source's text (AIV-P1-071); null when it carried too little signal. Never the text itself.
      textFingerprint: text('text_fingerprint'),
    },
    (t) => [
      unique('source_workspace_candidate_key').on(t.workspaceId, t.id, t.candidateId),
      // Must list exactly SOURCE_KINDS (domain/evidence.ts); changing it needs a new migration.
      check(
        'source_kind_check',
        sql`${t.kind} in ('cv', 'repository', 'document', 'shipped_product', 'reference_call', 'portal_submission', 'interview_note')`,
      ),
      check('source_url_check', sql`${t.url} is null or ${t.url} like 'https://%'`),
      check('source_text_fingerprint_check', sql`${t.textFingerprint} ~ '^[0-9a-f]{16}$'`),
      // FileClean.v1 finds the CV sources waiting for a file (AIV-P1-025).
      index('source_blob_file_idx').on(t.workspaceId, t.blobFileId),
      tenantPolicy('source_tenant_isolation', t.workspaceId),
    ],
  )
  .enableRLS();

// One run of evidence mapping (AIV-P1-027) for a candidate, a job and its approved rubric version, with the prompt and
// model it ran on and its "What would change this" list. Runs are never deleted when a new version is mapped: earlier
// runs and their items stay for audit, and reads take the newest run per candidate and job.
export const mapping = evidence
  .table(
    'mapping',
    {
      id: uuid().primaryKey(),
      workspaceId: uuid('workspace_id').notNull(),
      candidateId: uuid('candidate_id').notNull(),
      // The jobs module's job and rubric version ids: opaque, no foreign key across modules.
      jobId: uuid('job_id').notNull(),
      rubricVersionId: uuid('rubric_version_id').notNull(),
      promptVersion: text('prompt_version').notNull(),
      model: text().notNull(),
      // Up to three checks, each closing a gap or a capped item of this run; the text is candidate data (never logged).
      changes: jsonb().$type<StoredChange[]>().notNull(),
      createdAt: timestamp('created_at', tz).notNull(),
    },
    (t) => [
      unique('mapping_workspace_id_key').on(t.workspaceId, t.id),
      index('mapping_candidate_job_idx').on(t.workspaceId, t.candidateId, t.jobId, t.createdAt),
      check('mapping_changes_check', sql`jsonb_array_length(${t.changes}) <= 3`),
      tenantPolicy('mapping_tenant_isolation', t.workspaceId),
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
      // The mapping run that cited this excerpt (AIV-P1-027); null for an item recorded from its source.
      mappingId: uuid('mapping_id'),
    },
    (t) => [
      foreignKey({
        name: 'item_mapping_fk',
        columns: [t.workspaceId, t.mappingId],
        foreignColumns: [mapping.workspaceId, mapping.id],
      }),
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
      // 0 until the item is mapped to a level (AIV-P1-027); 0 adds nothing to a score.
      level: smallint().notNull().default(0),
    },
    (t) => [
      primaryKey({ name: 'competency_link_pkey', columns: [t.workspaceId, t.itemId, t.competencyId] }),
      foreignKey({
        name: 'competency_link_item_fk',
        columns: [t.workspaceId, t.itemId],
        foreignColumns: [item.workspaceId, item.id],
      }),
      index('competency_link_job_idx').on(t.workspaceId, t.jobId),
      check('competency_link_level_check', sql`${t.level} between 0 and 5`),
      tenantPolicy('competency_link_tenant_isolation', t.workspaceId),
    ],
  )
  .enableRLS();

// "Also submitted by another applicant" (AIV-P1-071): two different candidates' near-duplicate sources, both in this
// workspace (the foreign keys include it). Neutral; a person resolves it with a reason, audited.
export const duplicateFlag = evidence
  .table(
    'duplicate_flag',
    {
      id: uuid().primaryKey(),
      workspaceId: uuid('workspace_id').notNull(),
      sourceId: uuid('source_id').notNull(),
      candidateId: uuid('candidate_id').notNull(),
      otherSourceId: uuid('other_source_id').notNull(),
      otherCandidateId: uuid('other_candidate_id').notNull(),
      similarity: doublePrecision().notNull(),
      resolution: text({ enum: DUPLICATE_RESOLUTIONS }),
      resolvedBy: uuid('resolved_by'),
      resolvedAt: timestamp('resolved_at', tz),
      createdAt: timestamp('created_at', tz).notNull(),
    },
    (t) => [
      foreignKey({
        name: 'duplicate_flag_source_fk',
        columns: [t.workspaceId, t.sourceId, t.candidateId],
        foreignColumns: [source.workspaceId, source.id, source.candidateId],
      }),
      foreignKey({
        name: 'duplicate_flag_other_source_fk',
        columns: [t.workspaceId, t.otherSourceId, t.otherCandidateId],
        foreignColumns: [source.workspaceId, source.id, source.candidateId],
      }),
      unique('duplicate_flag_pair_key').on(t.workspaceId, t.sourceId, t.otherSourceId),
      index('duplicate_flag_candidate_idx').on(t.workspaceId, t.candidateId),
      index('duplicate_flag_other_candidate_idx').on(t.workspaceId, t.otherCandidateId),
      check('duplicate_flag_candidates_check', sql`${t.candidateId} <> ${t.otherCandidateId}`),
      check('duplicate_flag_similarity_check', sql`${t.similarity} between 0 and 1`),
      // Must list exactly DUPLICATE_RESOLUTIONS (domain/fingerprint.ts); changing it needs a new migration.
      check(
        'duplicate_flag_resolution_check',
        sql`${t.resolution} in ('shared_group_project', 'same_template', 'needs_follow_up')`,
      ),
      // Resolved means a reason, a person and a time, together.
      check(
        'duplicate_flag_resolved_check',
        sql`(${t.resolution} is null) = (${t.resolvedBy} is null) and (${t.resolution} is null) = (${t.resolvedAt} is null)`,
      ),
      tenantPolicy('duplicate_flag_tenant_isolation', t.workspaceId),
    ],
  )
  .enableRLS();

// A GitHub repository read (AIV-P1-026): who commits are matched to, and what was measured. The login and emails are
// candidate personal data (PERSONAL_DATA_FIELDS). Measured columns stay null until the read succeeds.
export const repositoryRead = evidence
  .table(
    'repository_read',
    {
      workspaceId: uuid('workspace_id').notNull(),
      sourceId: uuid('source_id').notNull(),
      candidateId: uuid('candidate_id').notNull(),
      // The normalised https://github.com/<owner>/<repo> (domain/repository.ts), so spellings of one repository match.
      url: text().notNull(),
      // Null when the candidate supplied no login (AIV-P1-076): commits then match by the emails only.
      githubLogin: text('github_login'),
      emails: text().array().notNull(),
      status: text({ enum: REPOSITORY_READ_STATUSES }).notNull(),
      totalCommits: integer('total_commits'),
      authoredCommits: integer('authored_commits'),
      generatedOnlyCommits: integer('generated_only_commits'),
      generatedChecked: integer('generated_checked'),
      commitsTruncated: boolean('commits_truncated'),
      languages: jsonb().$type<Record<string, number>>(),
      pushedAt: timestamp('pushed_at', tz),
      hasTests: boolean('has_tests'),
      hasCi: boolean('has_ci'),
      // The skill-signal scan's coverage (AIV-P1-072): files counted outside ignored paths, and the first gap, if any.
      filesInspected: integer('files_inspected'),
      coverageGap: text('coverage_gap', { enum: COVERAGE_GAPS }),
    },
    (t) => [
      primaryKey({ name: 'repository_read_pkey', columns: [t.workspaceId, t.sourceId] }),
      // One read per candidate and repository, whichever path or spelling the link came by (AIV-P1-076).
      unique('repository_read_candidate_url_key').on(t.workspaceId, t.candidateId, t.url),
      foreignKey({
        name: 'repository_read_source_fk',
        columns: [t.workspaceId, t.sourceId, t.candidateId],
        foreignColumns: [source.workspaceId, source.id, source.candidateId],
      }),
      // Must list exactly REPOSITORY_READ_STATUSES (domain/repository.ts); changing it needs a new migration.
      check('repository_read_status_check', sql`${t.status} in ('pending', 'read', 'not_accessible', 'fork')`),
      // A read repository has its numbers; generated-only commits are a subset of the checked authored ones.
      check(
        'repository_read_counts_check',
        sql`${t.status} <> 'read' or (${t.authoredCommits} between 0 and ${t.totalCommits}
          and ${t.generatedChecked} between 0 and ${t.authoredCommits}
          and ${t.generatedOnlyCommits} between 0 and ${t.generatedChecked})`,
      ),
      // Must list exactly COVERAGE_GAPS (domain/skill-signals/classify.ts); changing it needs a new migration.
      check(
        'repository_read_coverage_gap_check',
        sql`${t.coverageGap} in ('unreadable', 'rate_limited', 'truncated_listing', 'file_cap', 'oversized_file')`,
      ),
      check('repository_read_files_inspected_check', sql`${t.filesInspected} >= 0`),
      tenantPolicy('repository_read_tenant_isolation', t.workspaceId),
    ],
  )
  .enableRLS();

// A pull request the candidate authored, merged into a repository they do not own (AIV-P1-026); one evidence item each.
export const mergedPullRequest = evidence
  .table(
    'merged_pull_request',
    {
      workspaceId: uuid('workspace_id').notNull(),
      itemId: uuid('item_id').notNull(),
      candidateId: uuid('candidate_id').notNull(),
      // owner/name on GitHub.
      repository: text().notNull(),
      number: integer().notNull(),
      mergedAt: timestamp('merged_at', tz).notNull(),
      // The merging account's login; null when GitHub no longer names it (a deleted account).
      mergedBy: text('merged_by'),
      selfMerged: boolean('self_merged').notNull(),
    },
    (t) => [
      primaryKey({ name: 'merged_pull_request_pkey', columns: [t.workspaceId, t.itemId] }),
      foreignKey({
        name: 'merged_pull_request_item_fk',
        columns: [t.workspaceId, t.itemId],
        foreignColumns: [item.workspaceId, item.id],
      }),
      // A pull request is one item per candidate, however many of their repositories are read.
      unique('merged_pull_request_candidate_key').on(t.workspaceId, t.candidateId, t.repository, t.number),
      tenantPolicy('merged_pull_request_tenant_isolation', t.workspaceId),
    ],
  )
  .enableRLS();

// An evidence request (AIV-P1-037): one open request per candidate per job, with its follow-up policy. The message
// and each item's claim text are candidate personal data (never logged).
export const request = evidence
  .table(
    'request',
    {
      id: uuid().primaryKey(),
      workspaceId: uuid('workspace_id').notNull(),
      // Opaque ids of the candidates and jobs modules, and the identity user who created it.
      candidateId: uuid('candidate_id').notNull(),
      jobId: uuid('job_id').notNull(),
      requestedBy: uuid('requested_by').notNull(),
      message: text(),
      status: text({ enum: REQUEST_STATUSES }).notNull(),
      followUpAfterDays: smallint('follow_up_after_days').notNull().default(DEFAULT_FOLLOW_UP.afterDays),
      followUpMaxCount: smallint('follow_up_max_count').notNull().default(DEFAULT_FOLLOW_UP.maxCount),
      sentAt: timestamp('sent_at', tz),
      createdAt: timestamp('created_at', tz).notNull(),
    },
    (t) => [
      unique('request_workspace_id_key').on(t.workspaceId, t.id),
      // One open request per candidate per job; a closed one may be followed by a new one.
      uniqueIndex('request_open_key')
        .on(t.workspaceId, t.candidateId, t.jobId)
        .where(sql`${t.status} <> 'closed'`),
      // Must list exactly REQUEST_STATUSES (domain/request.ts); changing it needs a new migration.
      check('request_status_check', sql`${t.status} in ('draft', 'sent', 'opened', 'answered', 'quiet', 'closed')`),
      check('request_sent_check', sql`(${t.status} = 'draft') = (${t.sentAt} is null) or ${t.status} = 'closed'`),
      check('request_follow_up_check', sql`${t.followUpAfterDays} >= 1 and ${t.followUpMaxCount} >= 0`),
      tenantPolicy('request_tenant_isolation', t.workspaceId),
    ],
  )
  .enableRLS();

// One line per open claim the request asks about: the competency and the claim's own words.
export const requestItem = evidence
  .table(
    'request_item',
    {
      workspaceId: uuid('workspace_id').notNull(),
      requestId: uuid('request_id').notNull(),
      competencyId: uuid('competency_id').notNull(),
      itemId: uuid('item_id').notNull(),
      claim: text().notNull(),
    },
    (t) => [
      primaryKey({ name: 'request_item_pkey', columns: [t.workspaceId, t.requestId, t.competencyId] }),
      foreignKey({
        name: 'request_item_request_fk',
        columns: [t.workspaceId, t.requestId],
        foreignColumns: [request.workspaceId, request.id],
      }).onDelete('cascade'),
      foreignKey({
        name: 'request_item_item_fk',
        columns: [t.workspaceId, t.itemId],
        foreignColumns: [item.workspaceId, item.id],
      }),
      tenantPolicy('request_item_tenant_isolation', t.workspaceId),
    ],
  )
  .enableRLS();

// The upload portal's link (AIV-P1-041): only the SHA-256 of the token is stored, so a database read cannot open it.
export const portalToken = evidence
  .table(
    'portal_token',
    {
      workspaceId: uuid('workspace_id').notNull(),
      requestId: uuid('request_id').notNull(),
      tokenHash: text('token_hash').notNull(),
      expiresAt: timestamp('expires_at', tz).notNull(),
      createdAt: timestamp('created_at', tz).notNull(),
    },
    (t) => [
      primaryKey({ name: 'portal_token_pkey', columns: [t.workspaceId, t.requestId] }),
      unique('portal_token_hash_key').on(t.tokenHash),
      foreignKey({
        name: 'portal_token_request_fk',
        columns: [t.workspaceId, t.requestId],
        foreignColumns: [request.workspaceId, request.id],
      }).onDelete('cascade'),
      check('portal_token_hash_check', sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
      tenantPolicy('portal_token_tenant_isolation', t.workspaceId),
    ],
  )
  .enableRLS();

// What one file of a read repository showed about a skill (AIV-P1-072): the path and a sanitised detail, never the
// file's contents, which are read in memory and dropped. Replaced on every read of the source.
export const repositorySkillSignal = evidence
  .table(
    'repository_skill_signal',
    {
      workspaceId: uuid('workspace_id').notNull(),
      sourceId: uuid('source_id').notNull(),
      position: integer().notNull(),
      skill: text().notNull(),
      path: text().notNull(),
      kind: text({ enum: SIGNAL_KINDS }).notNull(),
      weight: text({ enum: SIGNAL_WEIGHTS }).notNull(),
      detail: text().notNull(),
    },
    (t) => [
      primaryKey({ name: 'repository_skill_signal_pkey', columns: [t.workspaceId, t.sourceId, t.position] }),
      foreignKey({
        name: 'repository_skill_signal_read_fk',
        columns: [t.workspaceId, t.sourceId],
        foreignColumns: [repositoryRead.workspaceId, repositoryRead.sourceId],
      }),
      // Must list exactly SIGNAL_KINDS and SIGNAL_WEIGHTS (domain/skill-signals/classify.ts).
      check('repository_skill_signal_kind_check', sql`${t.kind} in ('manifest', 'config', 'path', 'readme')`),
      check('repository_skill_signal_weight_check', sql`${t.weight} in ('code', 'declaration')`),
      check('repository_skill_signal_detail_check', sql`char_length(${t.detail}) <= 160`),
      tenantPolicy('repository_skill_signal_tenant_isolation', t.workspaceId),
    ],
  )
  .enableRLS();

// A read repository's grade for one target skill of one rubric version's competency (AIV-P1-072), with up to six
// citations. NO_EVIDENCE and UNABLE_TO_VERIFY are never a negative signal (AGENTS.md 1.6).
export const repositorySkillGrade = evidence
  .table(
    'repository_skill_grade',
    {
      workspaceId: uuid('workspace_id').notNull(),
      sourceId: uuid('source_id').notNull(),
      // The jobs module's rubric version and competency ids: opaque, no foreign key across modules.
      rubricVersionId: uuid('rubric_version_id').notNull(),
      competencyId: uuid('competency_id').notNull(),
      skill: text().notNull(),
      grade: text({ enum: SKILL_GRADES }).notNull(),
      reason: text({ enum: GRADE_REASONS }).notNull(),
      citations: jsonb().$type<Citation[]>().notNull(),
    },
    (t) => [
      primaryKey({
        name: 'repository_skill_grade_pkey',
        columns: [t.workspaceId, t.sourceId, t.rubricVersionId, t.competencyId, t.skill],
      }),
      foreignKey({
        name: 'repository_skill_grade_read_fk',
        columns: [t.workspaceId, t.sourceId],
        foreignColumns: [repositoryRead.workspaceId, repositoryRead.sourceId],
      }),
      index('repository_skill_grade_rubric_idx').on(t.workspaceId, t.rubricVersionId),
      // Must list exactly SKILL_GRADES and GRADE_REASONS (domain/skill-signals/classify.ts).
      check(
        'repository_skill_grade_grade_check',
        sql`${t.grade} in ('STRONG', 'PARTIAL', 'NO_EVIDENCE', 'UNABLE_TO_VERIFY')`,
      ),
      check(
        'repository_skill_grade_reason_check',
        sql`${t.reason} in ('code_corroborated', 'code_files', 'declaration_only', 'single_code_file', 'not_found',
          'not_detectable', 'unreadable', 'rate_limited', 'truncated_listing', 'file_cap', 'oversized_file')`,
      ),
      check('repository_skill_grade_citations_check', sql`jsonb_array_length(${t.citations}) <= 6`),
      tenantPolicy('repository_skill_grade_tenant_isolation', t.workspaceId),
    ],
  )
  .enableRLS();

// A rubric competency nothing backs after a mapping run (AIV-P1-027): evidence to request (AIV-P1-037), never negative
// evidence and never a reason to reject (AGENTS.md 1.6).
export const evidenceGap = evidence
  .table(
    'evidence_gap',
    {
      id: uuid().primaryKey(),
      workspaceId: uuid('workspace_id').notNull(),
      mappingId: uuid('mapping_id').notNull(),
      competencyId: uuid('competency_id').notNull(),
      kind: text({ enum: GAP_KINDS }).notNull(),
      // The repository scan's coverage behind `not_found` or `unable_to_verify`; null for `no_evidence`.
      filesInspected: integer('files_inspected'),
      coverageReason: text('coverage_reason', { enum: GRADE_REASONS }),
    },
    (t) => [
      foreignKey({
        name: 'evidence_gap_mapping_fk',
        columns: [t.workspaceId, t.mappingId],
        foreignColumns: [mapping.workspaceId, mapping.id],
      }),
      unique('evidence_gap_workspace_id_key').on(t.workspaceId, t.id),
      unique('evidence_gap_competency_key').on(t.workspaceId, t.mappingId, t.competencyId),
      // Must list exactly GAP_KINDS (domain/mapping.ts); changing it needs a new migration.
      check('evidence_gap_kind_check', sql`${t.kind} in ('not_found', 'unable_to_verify', 'no_evidence')`),
      check(
        'evidence_gap_coverage_check',
        sql`(${t.kind} = 'no_evidence') = (${t.filesInspected} is null)
          and (${t.filesInspected} is null) = (${t.coverageReason} is null) and ${t.filesInspected} >= 0`,
      ),
      tenantPolicy('evidence_gap_tenant_isolation', t.workspaceId),
    ],
  )
  .enableRLS();

// A CV parse (AIV-P1-025): pending until the worker has read the clean file; then parsed, unreadable or failed.
export const cvParse = evidence
  .table(
    'cv_parse',
    {
      workspaceId: uuid('workspace_id').notNull(),
      sourceId: uuid('source_id').notNull(),
      candidateId: uuid('candidate_id').notNull(),
      status: text({ enum: CV_PARSE_STATUSES }).notNull(),
    },
    (t) => [
      primaryKey({ name: 'cv_parse_pkey', columns: [t.workspaceId, t.sourceId] }),
      foreignKey({
        name: 'cv_parse_source_fk',
        columns: [t.workspaceId, t.sourceId, t.candidateId],
        foreignColumns: [source.workspaceId, source.id, source.candidateId],
      }),
      // Must list exactly CV_PARSE_STATUSES (domain/cv.ts); changing it needs a new migration.
      check('cv_parse_status_check', sql`${t.status} in ('pending', 'parsed', 'unreadable', 'failed')`),
      tenantPolicy('cv_parse_tenant_isolation', t.workspaceId),
    ],
  )
  .enableRLS();

// A document's read (AIV-P1-028): pending until the worker has read the clean file; then read, unreadable or failed.
// Its text is held by the source's items (one per page), never here.
export const documentRead = evidence
  .table(
    'document_read',
    {
      workspaceId: uuid('workspace_id').notNull(),
      sourceId: uuid('source_id').notNull(),
      candidateId: uuid('candidate_id').notNull(),
      status: text({ enum: DOCUMENT_READ_STATUSES }).notNull(),
    },
    (t) => [
      primaryKey({ name: 'document_read_pkey', columns: [t.workspaceId, t.sourceId] }),
      foreignKey({
        name: 'document_read_source_fk',
        columns: [t.workspaceId, t.sourceId, t.candidateId],
        foreignColumns: [source.workspaceId, source.id, source.candidateId],
      }),
      // Must list exactly DOCUMENT_READ_STATUSES (domain/document.ts); changing it needs a new migration.
      check('document_read_status_check', sql`${t.status} in ('pending', 'read', 'unreadable', 'failed')`),
      tenantPolicy('document_read_tenant_isolation', t.workspaceId),
    ],
  )
  .enableRLS();

// "Unusual content in this source" (AIV-P1-025, AIV-P1-070): text in a source aimed at an AI or hidden in the file. The
// excerpt quotes the candidate's source: personal data, never logged. A note changes no score, strength or stage.
export const sourceNote = evidence
  .table(
    'source_note',
    {
      id: uuid().primaryKey(),
      workspaceId: uuid('workspace_id').notNull(),
      sourceId: uuid('source_id').notNull(),
      candidateId: uuid('candidate_id').notNull(),
      reason: text({ enum: NOTE_REASONS }).notNull(),
      excerpt: text().notNull(),
      excerptSpan: text('excerpt_span'),
      createdAt: timestamp('created_at', tz).notNull(),
    },
    (t) => [
      foreignKey({
        name: 'source_note_source_fk',
        columns: [t.workspaceId, t.sourceId, t.candidateId],
        foreignColumns: [source.workspaceId, source.id, source.candidateId],
      }),
      index('source_note_source_idx').on(t.workspaceId, t.sourceId),
      // Must list exactly NOTE_REASONS (domain/cv.ts); changing it needs a new migration.
      check('source_note_reason_check', sql`${t.reason} in ('instruction', 'role_marker', 'tool_call', 'hidden_text')`),
      check('source_note_excerpt_check', sql`btrim(${t.excerpt}) <> ''`),
      tenantPolicy('source_note_tenant_isolation', t.workspaceId),
    ],
  )
  .enableRLS();

// Handled message ids of the evidence consumers (AIV-P0-015).
export const inbox = inboxTable(evidence);

// Events written in the same transaction as the change; the relay sends them to Service Bus (AIV-P0-014).
export const outbox = outboxTable(evidence);
