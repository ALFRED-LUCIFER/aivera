import {
  compareTradeoffsRequest,
  detectUnusualContent,
  keptTradeoffs,
  type Identifiers,
  type TradeoffGroup,
} from '@credalent/ai';
import { log } from '@credalent/observability';
import type { WorkspaceContext } from '@credalent/workspaces';
import { FACTS_ID, type ExplanationStatement } from '../domain/explain.ts';
import { MAX_COMPARED, tradeoffFacts } from '../domain/tradeoffs.ts';
import type { StoredAssessment } from './assessment.ts';
import { KIND, unusable, type ExplainPorts } from './explain.ts';

/**
 * "The trade-offs" of a comparison (AIV-P1-047): each compared candidate's statements, in the order asked, or
 * `unavailable` when the model could not be asked (no AI, today's allowance spent) or its answer was rejected.
 */
export type Tradeoffs =
  | { status: 'written'; candidates: { candidateId: string; statements: ExplanationStatement[] }[] }
  | { status: 'unavailable' };

export type TradeoffPorts = Pick<
  ExplainPorts,
  'storeFor' | 'authorize' | 'candidateJob' | 'ai' | 'approvedRubric' | 'evidence' | 'identifiersOf'
>;

/** A candidate's facts source among the sources sent; evidence items use their own ids. */
const factsId = (index: number) => `${FACTS_ID}:${index}`;

const unavailable = (reason: string): Tradeoffs => {
  // The reason only: no output, quote or candidate value reaches the log (AGENTS.md 1.2).
  log.warn({ 'credalent.ai.task': 'assessment.compareTradeoffs', 'error.type': reason }, 'trade-offs are unavailable');
  return { status: 'unavailable' };
};

export function tradeoffUseCases(ports: TradeoffPorts) {
  const { storeFor, authorize, candidateJob, ai, approvedRubric, evidence, identifiersOf } = ports;
  return {
    /**
     * One model call, on demand, to pick what sets each compared candidate's evidence apart and what is still open.
     * The model writes nothing that is shown: every statement is a facts line written here from the snapshots, or an
     * excerpt of that candidate's cited work, whole. Null unless 2 to `MAX_COMPARED` different
     * candidates each have a snapshot on the job's approved rubric version. `candidate.view` on the job for each.
     * It ranks, rejects, advances and contacts nobody (AGENTS.md 1.5), stores nothing and is not audited.
     */
    // shortcut: not stored, so every ask is a model call and a reload loses the text; store it per set of snapshots
    // (with the candidates' deletion reaching it) if pilot recruiters re-open comparisons.
    // shortcut: the model is called inside the request's transaction, as `explainRanking` does.
    async compareTradeoffs(
      ctx: WorkspaceContext,
      jobId: string,
      candidateIds: readonly string[],
    ): Promise<Tradeoffs | null> {
      if (candidateIds.length < 2 || candidateIds.length > MAX_COMPARED) return null;
      if (new Set(candidateIds).size !== candidateIds.length) return null;
      const snapshots: StoredAssessment[] = [];
      for (const candidateId of candidateIds) {
        // SAFETY: each candidate is authorised on the job before anything of theirs is read.
        await authorize(ctx, 'candidate.view', (await candidateJob(ctx, candidateId, jobId)) ?? undefined);
        const snapshot = await storeFor(ctx.tx).latest(ctx.workspaceId, candidateId, jobId);
        if (!snapshot) return null;
        snapshots.push(snapshot);
      }
      const rubric = await approvedRubric(ctx.tx, ctx.workspaceId, jobId);
      if (!rubric || snapshots.some((s) => s.rubricVersionId !== rubric.id)) return null;

      const items = [];
      const people: Identifiers[] = [];
      let unknownPerson = false;
      for (const candidateId of candidateIds) {
        items.push(await evidence(ctx, candidateId, jobId));
        const person = await identifiersOf(ctx, candidateId);
        if (person) people.push(person);
        else unknownPerson = true;
      }
      const facts = tradeoffFacts(snapshots, new Map(rubric.competencies.map((c) => [c.id, c.name])), items);
      if (facts.some((f) => f.lines.length === 0)) return null;
      // SAFETY: fails closed: with one person's identifiers unknown, nobody's sources are sent.
      if (unknownPerson) return unavailable('MissingIdentifiers');

      const groups = facts.map((f, i): TradeoffGroup => [
        { id: factsId(i), kind: 'document', text: f.lines.join('\n') },
        ...f.items
          // SAFETY: an excerpt holding text aimed at an AI or a reviewer ("Unusual content in this source", AIV-P1-070)
          // is never offered as a pick, so it cannot be shown here as a trade-off.
          .filter((s) => detectUnusualContent(s.text).length === 0)
          .map((s) => ({ id: s.id, kind: s.kind === 'facts' ? ('document' as const) : KIND[s.kind], text: s.text })),
      ]);
      let answer;
      try {
        answer = await ai.generateStructured({
          ...compareTradeoffsRequest(groups),
          workspaceId: ctx.workspaceId,
          // Every compared person's identifiers are replaced in every source (ADR-006 point 7).
          identifiers: {
            names: people.flatMap((p) => p.names),
            emails: people.flatMap((p) => p.emails),
            phones: people.flatMap((p) => p.phones),
          },
        });
      } catch (error) {
        if (!unusable(error)) throw error;
        return unavailable(error.name);
      }

      // No word kept is the model's: each statement is a facts line written above or a cited excerpt, whole.
      const candidates = keptTradeoffs(answer, groups).map(({ statements }, i) => {
        const labels = new Map(facts[i]?.items.map((s) => [s.id, s.label]));
        return {
          candidateId: candidateIds[i] ?? '',
          statements: statements.map(({ text, citations }) => ({
            text,
            citations: citations.map((c) => ({
              itemId: c.sourceId === factsId(i) ? null : c.sourceId,
              label: labels.get(c.sourceId) ?? 'Snapshot',
              quote: c.quote,
            })),
          })),
        };
      });
      // SAFETY: a comparison with nothing left to say of one candidate is not shown: it would read as one-sided.
      if (candidates.some((c) => c.statements.length === 0)) return unavailable('StatementsDropped');
      return { status: 'written', candidates };
    },
  };
}
