import {
  AiUnavailable,
  BudgetExceeded,
  CANDIDATE_PLACEHOLDER,
  EXPLAIN_RANKING_VERSION,
  InvalidCitation,
  MissingIdentifiers,
  SchemaMismatch,
  SourceTooLong,
  UncitedOutput,
  explainRankingRequest,
  type AiClient,
  type Identifiers,
  type Source,
} from '@credalent/ai';
import type { Tx } from '@credalent/db';
import type { EvidenceItemView } from '@credalent/evidence';
import { log } from '@credalent/observability';
import type { WorkspaceContext } from '@credalent/workspaces';
import {
  citationOf,
  factsOf,
  fill,
  statementAllowed,
  FACTS_ID,
  templateStatements,
  type ExplainSource,
  type ExplanationStatement,
} from '../domain/explain.ts';
import type { Ports } from './assessment.ts';

/**
 * A ranking explanation (AIV-P1-033): `ai` when the model wrote it, `template` when it was built without one and must
 * be shown as "Summary generated without AI". `resultId` is the snapshot it explains.
 */
export type RankingExplanation = { resultId: string; source: 'ai' | 'template'; statements: ExplanationStatement[] };

export type ExplanationStore = {
  get(workspaceId: string, resultId: string, promptVersion: string): Promise<ExplanationStatement[] | null>;
  put(row: {
    resultId: string;
    promptVersion: string;
    workspaceId: string;
    statements: ExplanationStatement[];
    createdAt: Date;
  }): Promise<void>;
};

/** What the explanation reads besides the snapshot; the app's composition root wires each from its module. */
export type ExplainPorts = Pick<Ports, 'storeFor' | 'authorize' | 'candidateJob' | 'now'> & {
  explanationsFor(tx: Tx): ExplanationStore;
  ai: Pick<AiClient, 'generateStructured'>;
  /** The job's approved rubric version and its competencies' names (the jobs module's `approvedRubric`). */
  approvedRubric(
    tx: Tx,
    workspaceId: string,
    jobId: string,
  ): Promise<{ id: string; competencies: readonly { id: string; name: string }[] } | null>;
  /** The candidate's evidence for the job (the evidence contract's `listEvidenceForCandidate`). */
  evidence(ctx: WorkspaceContext, candidateId: string, jobId: string): Promise<EvidenceItemView[]>;
  /** The person's identifiers the client replaces in every source (ADR-006 point 7); undefined: none known. */
  identifiersOf(ctx: WorkspaceContext, candidateId: string): Promise<Identifiers | undefined>;
};

// The kinds the client's citation contract knows (citations.ts SourceKind), for each evidence source kind.
const KIND: Record<EvidenceItemView['source']['kind'], Source['kind']> = {
  cv: 'cv',
  repository: 'repo',
  document: 'document',
  shipped_product: 'document',
  reference_call: 'reference',
  portal_submission: 'document',
  interview_note: 'interview',
};

// The model could not give a usable answer: the template is shown instead. Anything else (a bug, a database error)
// still throws. Errors carry the task and a reason, never output or candidate values (AGENTS.md 1.2).
const unusable = (error: unknown) =>
  error instanceof AiUnavailable ||
  error instanceof BudgetExceeded ||
  error instanceof SourceTooLong ||
  error instanceof MissingIdentifiers ||
  error instanceof InvalidCitation ||
  error instanceof SchemaMismatch ||
  error instanceof UncitedOutput;

export function explainUseCases(ports: ExplainPorts) {
  return {
    /**
     * Why the candidate's latest snapshot is what it is, in up to three statements each citing a snapshot fact or an
     * evidence item. Numbers are filled from the snapshot; a statement with no citation, or with a placeholder the
     * snapshot has no fact for, is dropped; an answer off the schema or citing a source it was not given is rejected
     * and the template shown. Cached per snapshot and prompt version. Null with no snapshot, or one on a rubric
     * version that is no longer the approved one (it is being scored again). `candidate.view` on the job, as `getLatestAssessment`.
     */
    // shortcut: the model is called inside the request's transaction. Worst case is 2 schema attempts x 3 transient
    // attempts x 45 s plus backoff (about 4.5 min), longer than the 240 s ingress timeout, so a very slow model can drop
    // the request; two requests for one snapshot may also both call it (the first answer is kept). Move the call to a
    // worker, or lock per snapshot, if pilot traffic shows either.
    // shortcut: the template is never cached: it is cheap, and the model may be back on the next request.
    async explainRanking(
      ctx: WorkspaceContext,
      candidateId: string,
      jobId: string,
    ): Promise<RankingExplanation | null> {
      const { storeFor, authorize, candidateJob, now, explanationsFor, ai, approvedRubric, evidence, identifiersOf } =
        ports;
      await authorize(ctx, 'candidate.view', (await candidateJob(ctx, candidateId, jobId)) ?? undefined);
      const snapshot = await storeFor(ctx.tx).latest(ctx.workspaceId, candidateId, jobId);
      if (!snapshot) return null;
      // Read only after the job was authorised above, as the ranked page does.
      const rubric = await approvedRubric(ctx.tx, ctx.workspaceId, jobId);
      if (rubric?.id !== snapshot.rubricVersionId) return null;
      const cache = explanationsFor(ctx.tx);
      const cached = await cache.get(ctx.workspaceId, snapshot.id, EXPLAIN_RANKING_VERSION);
      if (cached) return { resultId: snapshot.id, source: 'ai', statements: cached };

      // shortcut: evidence read after the snapshot, so an item recorded since is not yet in the snapshot's citations and
      // one cited by it but no longer listed is left out; the next snapshot catches up.
      const facts = factsOf(
        snapshot,
        new Map(rubric.competencies.map((c) => [c.id, c.name])),
        await evidence(ctx, candidateId, jobId),
      );
      const template = { resultId: snapshot.id, source: 'template' as const, statements: templateStatements(facts) };
      if (facts.factsText === null) return template;

      const shown: ExplainSource[] = [
        { id: FACTS_ID, label: 'Snapshot', kind: 'facts', text: facts.factsText },
        ...facts.items,
      ];
      let statements: ExplanationStatement[];
      try {
        const answer = await ai.generateStructured({
          ...explainRankingRequest(
            shown.map((s) => ({ id: s.id, kind: s.kind === 'facts' ? 'document' : KIND[s.kind], text: s.text })),
          ),
          workspaceId: ctx.workspaceId,
          identifiers: await identifiersOf(ctx, candidateId),
        });
        const byId = new Map(shown.map((s) => [s.id, s]));
        statements = answer.statements.flatMap(({ text, citations }) => {
          const filled = fill(text.replaceAll(CANDIDATE_PLACEHOLDER, 'the candidate'), facts.values);
          const cites = citations.flatMap((c) => {
            const source = byId.get(c.sourceId);
            return source ? [citationOf(source, c.quote)] : [];
          });
          // The model is told the rules; code decides (statementAllowed).
          return filled === null || !statementAllowed(text, facts) || cites.length === 0
            ? []
            : [{ text: filled, citations: cites }];
        });
      } catch (error) {
        if (!unusable(error)) throw error;
        // The error name only: no output, quote or candidate value reaches the log.
        log.warn(
          { 'credalent.ai.task': 'assessment.explainRanking', 'error.type': (error as Error).name },
          'ranking explanation fell back to the template',
        );
        return template;
      }
      if (statements.length === 0) return template;
      await cache.put({
        resultId: snapshot.id,
        promptVersion: EXPLAIN_RANKING_VERSION,
        workspaceId: ctx.workspaceId,
        statements,
        createdAt: now(),
      });
      // Re-read, so a concurrent viewer whose answer lost the insert shows the stored text, not its own.
      const stored = await cache.get(ctx.workspaceId, snapshot.id, EXPLAIN_RANKING_VERSION);
      return { resultId: snapshot.id, source: 'ai', statements: stored ?? statements };
    },
  };
}
