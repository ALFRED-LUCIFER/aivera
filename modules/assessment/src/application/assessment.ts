import type { Tx } from '@credalent/db';
import type { EvidenceItemView } from '@credalent/evidence';
import type { Action, WorkspaceContext } from '@credalent/workspaces';
import { assess, type Assessment, type EvidenceLink, type RubricInput } from '../domain/assess.ts';

export type StoredAssessment = Assessment & {
  id: string;
  workspaceId: string;
  candidateId: string;
  jobId: string;
  assessedAt: Date;
};

/** The store over one workspace-scoped transaction. Every method filters by `workspaceId`. */
export type AssessmentStore = {
  latest(workspaceId: string, candidateId: string, jobId: string): Promise<StoredAssessment | null>;
  insert(row: StoredAssessment): Promise<void>;
};

/** The audited summary of a stored result: ids, levels and numbers only (AGENTS.md 1.2). */
export type ScoreSummary = Record<string, string | number>;

export type ScoreChange = { candidateId: string; before: ScoreSummary | null; after: ScoreSummary };

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
  authorize(ctx: WorkspaceContext, action: Action): Promise<void>;
  /** Writes `score.changed` to the audit log in `ctx.tx`: the last statement before commit (AGENTS.md 3.6). */
  auditScoreChange(ctx: WorkspaceContext, change: ScoreChange): Promise<void>;
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
const canonical = (value: unknown) =>
  JSON.stringify(value, (_, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).toSorted()) : v,
  );
const sameResult = (a: Assessment, b: Assessment) => canonical(a) === canonical(b);

const pickAssessment = (s: StoredAssessment): Assessment => ({
  rubricVersionId: s.rubricVersionId,
  backedScore: s.backedScore,
  upperBound: s.upperBound,
  meetsNeed: s.meetsNeed,
  competencyCount: s.competencyCount,
  missingCritical: s.missingCritical,
  confidence: s.confidence,
  competencies: s.competencies,
});

// shortcut: the caller passes the approved rubric's competencies with their ids, because the jobs contract does not
// return competency ids yet; the worker that assesses on events (AIV-P1-031) reads them once AIV-P1-027 exposes them.
export function assessmentUseCases({ storeFor, authorize, auditScoreChange, newId, now }: Ports) {
  return {
    /**
     * Assesses the candidate and stores the result when it differs from the latest one; every stored result is
     * audited. Nothing is rejected, advanced or sent: the result only orders attention (AGENTS.md 1.5).
     */
    async assessCandidate(ctx: WorkspaceContext, input: AssessCandidateInput): Promise<StoredAssessment> {
      // No job passed on purpose: only admins and recruiters assess; job-scoped roles read scores through their job later.
      await authorize(ctx, 'candidate.create');
      // shortcut: read-latest-then-insert is not serialised, so two concurrent runs can both store and audit; the worker
      // that assesses on events serialises per candidate and job (AIV-P1-031).
      const store = storeFor(ctx.tx);
      const next = assess(input.rubric, toLinks(input.candidateId, input.jobId, input.evidence));
      const previous = await store.latest(ctx.workspaceId, input.candidateId, input.jobId);
      if (previous && sameResult(pickAssessment(previous), next)) return previous;
      const row: StoredAssessment = {
        ...next,
        id: newId(),
        workspaceId: ctx.workspaceId,
        candidateId: input.candidateId,
        jobId: input.jobId,
        assessedAt: now(),
      };
      await store.insert(row);
      // Every stored result is a score change (a level, a citation, the rubric version), so every one is audited.
      await auditScoreChange(ctx, {
        candidateId: input.candidateId,
        // The stored result ids tell entries apart when only the citations changed.
        before: previous && { resultId: previous.id, ...summarise(pickAssessment(previous)) },
        after: { resultId: row.id, ...summarise(next) },
      });
      return row;
    },

    /** The latest assessment of the candidate for the job, or null. Admins and recruiters. */
    async getLatestAssessment(ctx: WorkspaceContext, candidateId: string, jobId: string) {
      await authorize(ctx, 'candidate.view');
      return storeFor(ctx.tx).latest(ctx.workspaceId, candidateId, jobId);
    },
  };
}
