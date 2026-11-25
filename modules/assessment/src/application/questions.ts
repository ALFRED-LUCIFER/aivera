import {
  BudgetExceeded,
  CANDIDATE_PLACEHOLDER,
  InvalidCitation,
  SUGGEST_QUESTIONS_VERSION,
  SchemaMismatch,
  suggestQuestionsRequest,
  type QuestionGapInput,
  type Source,
} from '@credalent/ai';
import type { Tx } from '@credalent/db';
import { log } from '@credalent/observability';
import type { WorkspaceContext } from '@credalent/workspaces';
import { competencySourceId, selectGaps, storedGaps, type Gap, type SuggestedGap } from '../domain/questions.ts';
import type { StoredAssessment } from './assessment.ts';
import { KIND, unusable, type ExplainPorts } from './explain.ts';

/**
 * The suggested interview questions of a candidate for a job (AIV-P1-113). `no_gaps`: nothing in the latest snapshot
 * needs live verification. `not_suggested`: it has gaps and nobody asked yet. `suggested`: the stored questions, with
 * `resultId` the snapshot they were made from and `stale` when the evidence has changed the snapshot since.
 */
export type SuggestedQuestions =
  | { status: 'no_gaps'; resultId: string }
  | { status: 'not_suggested'; resultId: string }
  | { status: 'suggested'; resultId: string; stale: boolean; gaps: SuggestedGap[]; suggestedAt: Date };

/**
 * What asking for questions gives: the set (new or already stored), or why there is none. `budget_exceeded`: the
 * workspace's daily AI budget is spent and no model request was made. `failed`: the model was unavailable, or its
 * answer was rejected twice. Neither stores anything.
 */
export type SuggestQuestionsResult =
  Exclude<SuggestedQuestions, { status: 'not_suggested' }> | { status: 'budget_exceeded' } | { status: 'failed' };

type StoredQuestions = { resultId: string; gaps: SuggestedGap[]; createdAt: Date };

export type QuestionStore = {
  /** The newest stored set among the candidate's snapshots for the job on this rubric version, or null. */
  latest(
    workspaceId: string,
    candidateId: string,
    jobId: string,
    rubricVersionId: string,
  ): Promise<StoredQuestions | null>;
  /** Stores a snapshot's set; a second set for the same snapshot is dropped, so the first stands. */
  put(row: StoredQuestions & { workspaceId: string; promptVersion: string }): Promise<void>;
};

/** What the questions read besides the snapshot; the app's composition root wires each from its module. */
export type QuestionPorts = Pick<
  ExplainPorts,
  'storeFor' | 'authorize' | 'candidateJob' | 'now' | 'ai' | 'evidence' | 'identifiersOf'
> & {
  questionsFor(tx: Tx): QuestionStore;
  /** The job's approved rubric version with each competency's meaning (the jobs module's `approvedRubric`). */
  approvedRubric(
    tx: Tx,
    workspaceId: string,
    jobId: string,
  ): Promise<{ id: string; competencies: readonly { id: string; name: string; evidenceExpected: string }[] } | null>;
  /** The "What would change this" checks of the candidate's newest evidence mapping for the job (AIV-P1-027). */
  changes(
    ctx: WorkspaceContext,
    candidateId: string,
    jobId: string,
  ): Promise<readonly { competencyId: string; text: string | null }[]>;
  /** The job's title and its rubric's domain pack by name ("Payments and fintech"; null: none), or null for no such job. */
  jobOf(ctx: WorkspaceContext, jobId: string): Promise<{ title: string; domainPack: string | null } | null>;
};

// Why an answer was refused, as the telemetry names it: a rule's name from the schema or the contract, never output.
const reasonOf = (error: Error) =>
  error instanceof InvalidCitation
    ? 'unknown_citation'
    : error instanceof SchemaMismatch
      ? (error.rules[0]?.split(':')[1] ?? 'schema')
      : error.name;

// A placeholder the model repeats in a question reads as words, as in a ranking explanation.
const plain = (text: string) => text.replaceAll(CANDIDATE_PLACEHOLDER, 'the candidate');

const shown = (stored: StoredQuestions, stale: boolean) => ({
  status: 'suggested' as const,
  resultId: stored.resultId,
  stale,
  gaps: stored.gaps,
  suggestedAt: stored.createdAt,
});

export function questionUseCases(ports: QuestionPorts) {
  const { storeFor, authorize, candidateJob, questionsFor, approvedRubric } = ports;

  /** The latest snapshot on the approved rubric version, with that version; null with neither. Authorises first. */
  const current = async (ctx: WorkspaceContext, candidateId: string, jobId: string) => {
    await authorize(ctx, 'candidate.view', (await candidateJob(ctx, candidateId, jobId)) ?? undefined);
    const snapshot = await storeFor(ctx.tx).latest(ctx.workspaceId, candidateId, jobId);
    if (!snapshot) return null;
    // Read only after the job was authorised above, as the ranked page does.
    const rubric = await approvedRubric(ctx.tx, ctx.workspaceId, jobId);
    return rubric?.id === snapshot.rubricVersionId ? { snapshot, rubric } : null;
  };

  const read = async (ctx: WorkspaceContext, snapshot: StoredAssessment): Promise<SuggestedQuestions> => {
    const stored = await questionsFor(ctx.tx).latest(
      ctx.workspaceId,
      snapshot.candidateId,
      snapshot.jobId,
      snapshot.rubricVersionId,
    );
    if (stored?.resultId === snapshot.id) return shown(stored, false);
    if (selectGaps(snapshot).length === 0) return { status: 'no_gaps', resultId: snapshot.id };
    return stored ? shown(stored, true) : { status: 'not_suggested', resultId: snapshot.id };
  };

  return {
    /**
     * The stored questions for the candidate's latest snapshot, read only: no model is called and nothing is written.
     * Null with no snapshot, or one on a rubric version that is no longer the approved one. `candidate.view` on the job.
     */
    async getSuggestedQuestions(
      ctx: WorkspaceContext,
      candidateId: string,
      jobId: string,
    ): Promise<SuggestedQuestions | null> {
      const found = await current(ctx, candidateId, jobId);
      return found && read(ctx, found.snapshot);
    },

    /**
     * Two or three open questions for each gap of the latest snapshot (`selectGaps`), each citing the gap's evidence,
     * stored for that snapshot: asking again returns the stored set and calls no model. One model call otherwise.
     * An answer off the schema, citing a source it was not given or naming a competency that is no gap is rejected and
     * asked for once more by the client, then `failed`. It changes no score, stage or rank (AGENTS.md 1.5).
     */
    // shortcut: the model is called inside the request's transaction, as `explainRanking` does, and two requests in
    // flight for one snapshot may both call it (the first answer is stored, the other dropped). Move the call to a
    // worker, or lock per snapshot, if pilot traffic shows either.
    async suggestInterviewQuestions(
      ctx: WorkspaceContext,
      candidateId: string,
      jobId: string,
    ): Promise<SuggestQuestionsResult | null> {
      const found = await current(ctx, candidateId, jobId);
      if (!found) return null;
      const { snapshot, rubric } = found;
      const before = await read(ctx, snapshot);
      if (before.status === 'no_gaps' || (before.status === 'suggested' && !before.stale)) return before;
      const job = await ports.jobOf(ctx, jobId);
      if (!job) return null;

      // shortcut: evidence read after the snapshot, so an item the snapshot cites but that is no longer listed is left
      // out, as in `explainRanking`; the next snapshot catches up.
      const items = new Map((await ports.evidence(ctx, candidateId, jobId)).map((item) => [item.id, item]));
      const changes = await ports.changes(ctx, candidateId, jobId);
      const competencies = new Map(rubric.competencies.map((c) => [c.id, c]));
      const sources: Source[] = [];
      // Listed after every evidence source, so an evidence item keeps its label whatever notes there are.
      const notes: Source[] = [];
      const labels = new Map<string, Gap>();
      const listed: QuestionGapInput[] = selectGaps(snapshot).flatMap((gap, i) => {
        const competency = competencies.get(gap.competencyId);
        if (!competency) return [];
        const cited = gap.itemIds.flatMap((id) => items.get(id) ?? []);
        // A competency with no evidence item is a source of its own, so its questions still cite what the model read.
        const own = cited.length
          ? cited.map((item) => ({
              source: { id: item.id, kind: KIND[item.source.kind], text: item.excerpt },
              evidence: `${item.strength}, ${item.provenance}`,
            }))
          : [
              {
                source: {
                  id: competencySourceId(gap.competencyId),
                  kind: 'job_description' as const,
                  text: `${competency.name}: ${competency.evidenceExpected}`,
                },
                evidence: 'the rubric, no evidence yet',
              },
            ];
        for (const { source } of own) if (!sources.some((s) => s.id === source.id)) sources.push(source);
        // What the gap's evidence does not show and what would change it are text an earlier model call wrote about
        // the candidate's sources: they go in a source block too (untrusted, identifiers replaced), never in the
        // prompt. A question may be aimed by them but cites the evidence: the schema refuses a citation of the notes.
        const lines = [
          ...new Set(cited.map((item) => `Limit: ${item.limit}`)),
          ...changes.flatMap((c) =>
            c.competencyId === gap.competencyId && c.text ? [`Would change this: ${c.text}`] : [],
          ),
        ];
        const listedSources: QuestionGapInput['sources'][number][] = own.map(({ source, evidence }) => ({
          id: source.id,
          evidence,
        }));
        if (lines.length) {
          const source = { id: `notes:${gap.competencyId}`, kind: 'document' as const, text: lines.join('\n') };
          notes.push(source);
          listedSources.push({ id: source.id, evidence: 'notes on this evidence, never cited', notes: true });
        }
        const label = `C${i + 1}`;
        labels.set(label, { ...gap, itemIds: cited.map((item) => item.id) });
        return [
          {
            id: label,
            name: competency.name,
            meaning: competency.evidenceExpected,
            levelNeeded: gap.levelNeeded,
            provenLevel: gap.provenLevel,
            claimedLevel: gap.claimedLevel,
            sources: listedSources,
          },
        ];
      });

      let gaps: SuggestedGap[];
      try {
        const answer = await ports.ai.generateStructured({
          ...suggestQuestionsRequest(job, listed, [...sources, ...notes]),
          workspaceId: ctx.workspaceId,
          identifiers: await ports.identifiersOf(ctx, candidateId),
        });
        gaps = storedGaps(
          answer.gaps.map((gap) => ({
            ...gap,
            questions: gap.questions.map((q) => ({
              ...q,
              text: plain(q.text),
              strongAnswer: plain(q.strongAnswer),
              weakAnswer: plain(q.weakAnswer),
            })),
          })),
          labels,
        );
      } catch (error) {
        if (!unusable(error)) throw error;
        // The rule's name only: no output, quote or candidate value reaches the log (AGENTS.md 1.2).
        log.warn(
          { 'credalent.ai.task': 'assessment.suggestQuestions', 'error.type': error.name, code: reasonOf(error) },
          'interview questions were not suggested',
        );
        return { status: error instanceof BudgetExceeded ? 'budget_exceeded' : 'failed' };
      }
      if (gaps.length === 0) return { status: 'failed' };
      const row = { resultId: snapshot.id, gaps, createdAt: ports.now() };
      await questionsFor(ctx.tx).put({
        ...row,
        workspaceId: ctx.workspaceId,
        promptVersion: SUGGEST_QUESTIONS_VERSION,
      });
      // Re-read, so a concurrent request whose answer lost the insert shows the stored set, not its own.
      const after = await read(ctx, snapshot);
      return after.status === 'suggested' ? after : shown(row, false);
    },
  };
}
