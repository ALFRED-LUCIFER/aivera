import type { Tx } from '@credalent/db';
import type { EvidenceItemView } from '@credalent/evidence';
import { ForbiddenError, type Action, type JobResource, type WorkspaceContext } from '@credalent/workspaces';
import { assess, type Assessment, type Confidence, type EvidenceLink, type RubricInput } from '../domain/assess.ts';
import { withInterviewChanges, type InterviewChange } from '../domain/scoreChange.ts';
import type { InterviewChangeRow } from './scoreChange.ts';

export type StoredAssessment = Assessment & {
  id: string;
  workspaceId: string;
  candidateId: string;
  jobId: string;
  assessedAt: Date;
};

/** The store over one workspace-scoped transaction. Every method filters by `workspaceId`. */
export type AssessmentStore = {
  /** Holds the candidate and job's assessment lock until commit, so concurrent runs store one result, not two. */
  lock(workspaceId: string, candidateId: string, jobId: string): Promise<void>;
  latest(workspaceId: string, candidateId: string, jobId: string): Promise<StoredAssessment | null>;
  byId(workspaceId: string, id: string): Promise<StoredAssessment | null>;
  /** The candidate's applied interview changes for the job, oldest first (AIV-P1-117). */
  interviewChanges(workspaceId: string, candidateId: string, jobId: string): Promise<InterviewChange[]>;
  insertInterviewChanges(rows: InterviewChangeRow[]): Promise<void>;
  /** What an apply with this idempotency key stored for the candidate and job, or null. */
  applied(
    workspaceId: string,
    candidateId: string,
    jobId: string,
    idempotencyKey: string,
  ): Promise<{ result: StoredAssessment; previewId: string; reason: string } | null>;
  insert(row: StoredAssessment): Promise<void>;
  /** Every result of the job, any rubric version, oldest first. */
  listForJob(workspaceId: string, jobId: string): Promise<StoredAssessment[]>;
  /** Per job, the candidates with a result on that job's rubric version: one read; jobs with none are absent. */
  assessedOnVersions(
    workspaceId: string,
    versions: readonly { jobId: string; rubricVersionId: string }[],
  ): Promise<Map<string, string[]>>;
};

/** One candidate in a job's ranking: their latest result on the job's approved rubric version. */
export type RankingRow = {
  /** The candidates module's opaque person id. */
  candidateId: string;
  /** 1-based, computed at read. */
  rank: number;
  backedScore: number;
  upperBound: number;
  meetsNeed: number;
  competencyCount: number;
  confidence: Confidence;
  /** As stored in `assessment.result`: mandatory competencies proven below the need, evidence to request. */
  missingCritical: string[];
  assessedAt: Date;
};

/** A job's ranking: nothing until a rubric version is approved (never ranked from a draft). */
export type JobRanking =
  { status: 'awaiting_rubric' } | { status: 'ranked'; rubricVersionId: string; rows: RankingRow[] };

/** Who assesses: a member (`userId`) or, on the worker, the system (`null`). */
export type Scope = { tx: Tx; workspaceId: string; userId: string | null };

/** The audited summary of a stored result: ids, levels and numbers only (AGENTS.md 1.2). */
export type ScoreSummary = Record<string, string | number | null>;

/** `note` is a person's reason (an interview-based change); without one the entry says it was assessed from the evidence. */
export type ScoreChange = { candidateId: string; before: ScoreSummary | null; after: ScoreSummary; note?: string };

/** Scores, confidence, the rubric version and each competency's proven level (`proven:<competency id>`). */
export function summarise(a: Assessment): ScoreSummary {
  return {
    rubricVersionId: a.rubricVersionId,
    backedScore: a.backedScore,
    upperBound: a.upperBound,
    meetsNeed: a.meetsNeed,
    confidence: a.confidence,
    ...Object.fromEntries(a.competencies.map((c) => [`proven:${c.competencyId}`, c.proven.level])),
  };
}

export type Ports = {
  storeFor(tx: Tx): AssessmentStore;
  authorize(ctx: WorkspaceContext, action: Action, resource?: JobResource): Promise<void>;
  /**
   * The job the candidate applied to as the context may see it, or null: a job-named read is authorised against this
   * stored record, never the request's job id (AIV-P1-091).
   */
  candidateJob(ctx: WorkspaceContext, candidateId: string, jobId: string): Promise<JobResource | null>;
  /**
   * The job as the context may see it (null: no such job, or outside the context's job scope) and its approved rubric
   * version id (null: none approved yet).
   */
  rankingJob(
    ctx: WorkspaceContext,
    jobId: string,
  ): Promise<{ resource: JobResource; approvedVersionId: string | null } | null>;
  /** Writes `score.changed` to the audit log in `scope.tx`: the last statement before commit (AGENTS.md 3.6). */
  auditScoreChange(scope: Scope, change: ScoreChange): Promise<void>;
  /**
   * Who applies to the job now (intake's `candidatesForJob`), so a candidate merged into another (AIV-P1-018) leaves
   * the ranking with their application. Without it every candidate with a result is ranked.
   */
  applicants?: (tx: Tx, workspaceId: string, jobId: string) => Promise<string[]>;
  newId(): string;
  now(): Date;
};

/** What to assess: the approved rubric version and the candidate's evidence for that job, as its contracts return them. */
export type AssessCandidateInput = {
  candidateId: string;
  jobId: string;
  rubric: RubricInput;
  evidence: readonly EvidenceItemView[];
};

/**
 * The score's input from the evidence contract: per link only the item id, the competency, the level, the strength
 * and the provenance. Everything else on an item or its source (an "Unusual content in this source" note, the
 * excerpt, the source) is dropped here, so it can never act on the candidate (AGENTS.md 1.5, 1.6).
 */
export function toLinks(candidateId: string, jobId: string, evidence: readonly EvidenceItemView[]): EvidenceLink[] {
  // Another candidate's item can never be cited in this candidate's score, whatever list the caller passed.
  return evidence
    .filter((item) => item.candidateId === candidateId)
    .flatMap((item) =>
      item.competencies
        .filter((c) => c.jobId === jobId)
        .map((c) => ({
          itemId: item.id,
          competencyId: c.competencyId,
          level: c.level,
          strength: item.strength,
          provenance: item.provenance,
        })),
    );
}

// jsonb stores object keys in its own order, so compare with keys sorted.
export const canonical = (value: unknown) =>
  JSON.stringify(value, (_, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).toSorted()) : v,
  );
export const sameResult = (a: Assessment, b: Assessment) => canonical(a) === canonical(b);

export const pickAssessment = (s: StoredAssessment): Assessment => ({
  rubricVersionId: s.rubricVersionId,
  backedScore: s.backedScore,
  upperBound: s.upperBound,
  meetsNeed: s.meetsNeed,
  competencyCount: s.competencyCount,
  missingCritical: s.missingCritical,
  confidence: s.confidence,
  competencies: s.competencies,
});

/**
 * Assesses the candidate and stores the result when it differs from the latest one; every stored result is audited.
 * Authorises nothing: `assessCandidate` checks the member first, and the worker acts for the envelope's workspace.
 */
export async function recordAssessment(
  { storeFor, auditScoreChange, newId, now }: Pick<Ports, 'storeFor' | 'auditScoreChange' | 'newId' | 'now'>,
  scope: Scope,
  input: AssessCandidateInput,
): Promise<{ stored: StoredAssessment; changed: boolean }> {
  const store = storeFor(scope.tx);
  // Taken again, harmlessly, after the worker's lock before its evidence read (assessForJob).
  // shortcut: `assessCandidate` gets evidence its caller read before this lock, so two concurrent calls can store the
  // older; only tests call it today (the worker scores); lock before the read if a screen ever calls it.
  await store.lock(scope.workspaceId, input.candidateId, input.jobId);
  // A person's applied interview changes stand in every later run (AIV-P1-117); read under the lock.
  // shortcut: changes are keyed by competency id, which belongs to one rubric version, so a newly approved version scores
  // without them; carry them across versions (competency lineage in the jobs module) before a pilot job re-approves its
  // rubric after interviews. They are also keyed by candidate id: a candidate merged into another (AIV-P1-018) keeps
  // theirs on the old id; move them with the merge when a merged candidate has been interviewed.
  const next = assess(
    input.rubric,
    withInterviewChanges(
      toLinks(input.candidateId, input.jobId, input.evidence),
      await store.interviewChanges(scope.workspaceId, input.candidateId, input.jobId),
    ),
  );
  const previous = await store.latest(scope.workspaceId, input.candidateId, input.jobId);
  if (previous && sameResult(pickAssessment(previous), next)) return { stored: previous, changed: false };
  const row: StoredAssessment = {
    ...next,
    id: newId(),
    workspaceId: scope.workspaceId,
    candidateId: input.candidateId,
    jobId: input.jobId,
    assessedAt: now(),
  };
  await store.insert(row);
  // Every stored result is a score change (a level, a citation, the rubric version), so every one is audited.
  await auditScoreChange(scope, {
    candidateId: input.candidateId,
    // The stored result ids tell entries apart when only the citations changed.
    before: previous && { resultId: previous.id, ...summarise(pickAssessment(previous)) },
    after: { resultId: row.id, ...summarise(next) },
  });
  return { stored: row, changed: true };
}

/**
 * The job's ranking from its results (oldest first): each candidate's latest on `versionId`, by backed score, then
 * upper bound, then who was assessed first for the job. A candidate with no result on `versionId` is not ranked yet.
 */
export function rank(results: readonly StoredAssessment[], versionId: string): RankingRow[] {
  // shortcut: "earliest application" is read as the candidate's first assessment for the job, because intake's
  // application dates are not this module's; take them through a port if the pilot shows the two orders differ.
  const first = new Map<string, number>();
  const latest = new Map<string, StoredAssessment>();
  for (const r of results) {
    if (!first.has(r.candidateId)) first.set(r.candidateId, r.assessedAt.getTime());
    if (r.rubricVersionId === versionId) latest.set(r.candidateId, r);
  }
  const firstOf = (r: StoredAssessment) => first.get(r.candidateId) ?? 0;
  return [...latest.values()]
    .toSorted(
      (a, b) =>
        b.backedScore - a.backedScore ||
        b.upperBound - a.upperBound ||
        firstOf(a) - firstOf(b) ||
        a.candidateId.localeCompare(b.candidateId),
    )
    .map((r, i) => ({
      candidateId: r.candidateId,
      rank: i + 1,
      backedScore: r.backedScore,
      upperBound: r.upperBound,
      meetsNeed: r.meetsNeed,
      competencyCount: r.competencyCount,
      confidence: r.confidence,
      missingCritical: r.missingCritical,
      assessedAt: r.assessedAt,
    }));
}

export function assessmentUseCases(ports: Ports) {
  const { storeFor, authorize, rankingJob, candidateJob, applicants } = ports;
  const currentApplicants = async (ctx: WorkspaceContext, jobId: string) =>
    applicants && new Set(await applicants(ctx.tx, ctx.workspaceId, jobId));
  return {
    /**
     * Assesses the candidate and stores the result when it differs from the latest one; every stored result is
     * audited. Nothing is rejected, advanced or sent: the result only orders attention (AGENTS.md 1.5).
     */
    async assessCandidate(ctx: WorkspaceContext, input: AssessCandidateInput): Promise<StoredAssessment> {
      // No job passed on purpose: only admins and recruiters assess; job-scoped roles read scores through their job.
      await authorize(ctx, 'candidate.create');
      return (await recordAssessment(ports, ctx, input)).stored;
    },

    /** The latest assessment of the candidate for the job, or null. Admins and recruiters. */
    async getLatestAssessment(ctx: WorkspaceContext, candidateId: string, jobId: string) {
      await authorize(ctx, 'candidate.view', (await candidateJob(ctx, candidateId, jobId)) ?? undefined);
      return storeFor(ctx.tx).latest(ctx.workspaceId, candidateId, jobId);
    },

    // shortcut: no paging; a pilot job has tens of applicants. Page with the ranked table once a job passes a few hundred.
    async listRanking(ctx: WorkspaceContext, jobId: string): Promise<JobRanking> {
      const job = await rankingJob(ctx, jobId);
      // A job outside the context's job scope is hidden by the jobs module: refused, so nothing says it exists.
      if (!job) throw new ForbiddenError();
      await authorize(ctx, 'candidate.view', job.resource);
      if (!job.approvedVersionId) return { status: 'awaiting_rubric' };
      const results = await storeFor(ctx.tx).listForJob(ctx.workspaceId, jobId);
      const current = await currentApplicants(ctx, jobId);
      const ranked = current ? results.filter((r) => current.has(r.candidateId)) : results;
      return { status: 'ranked', rubricVersionId: job.approvedVersionId, rows: rank(ranked, job.approvedVersionId) };
    },

    /** Per job, the candidates `listRanking` ranks: the same applicants filter, so "N assessed" matches its rows. */
    async countAssessed(ctx: WorkspaceContext, jobIds: readonly string[]): Promise<Record<string, number>> {
      const versions: { jobId: string; rubricVersionId: string }[] = [];
      // shortcut: one job read, and one applicants read per job with results; a workspace lists tens of jobs. Batch both
      // if the Jobs list outgrows that.
      for (const jobId of jobIds) {
        const job = await rankingJob(ctx, jobId);
        if (!job) throw new ForbiddenError();
        await authorize(ctx, 'candidate.view', job.resource);
        if (job.approvedVersionId) versions.push({ jobId, rubricVersionId: job.approvedVersionId });
      }
      const assessed = await storeFor(ctx.tx).assessedOnVersions(ctx.workspaceId, versions);
      const counts: Record<string, number> = {};
      for (const jobId of jobIds) {
        const ids = assessed.get(jobId) ?? [];
        const current = ids.length > 0 ? await currentApplicants(ctx, jobId) : undefined;
        counts[jobId] = current ? ids.filter((id) => current.has(id)).length : ids.length;
      }
      return counts;
    },
  };
}
