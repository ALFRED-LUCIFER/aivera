import type { Identifiers } from '@credalent/ai';
import type { StoredAssessment } from '@credalent/assessment';
import type { Tx } from '@credalent/db';
import type { EvidenceItemView } from '@credalent/evidence';
import {
  FACTS_ID,
  sourcesOf,
  type CitedStatement,
  type MemberSummary,
  type StoredMemberSummary,
  type SummarySource,
} from '../domain/summary.ts';
import type { PackStore } from './packs.ts';

/** A statement as the model's checked answer gives it: its citations name the caller's source ids. */
type Answered = { text: string; citations: { sourceId: string; quote: string }[] };
export type SummaryAnswer = {
  strengths: Answered[];
  risks: Answered[];
  round1: Answered | null;
  recommendation: { action: 'advance' | 'hold'; focus: string | null; citations: Answered['citations'] };
};

/** What the worker job reads besides the pack, each wired by the worker from its module, in the job's transaction. */
export type SummaryPorts = {
  storeFor(tx: Tx): PackStore;
  /** The stored assessment the member joined with (the assessment composition's `readAssessmentAsSystem`). */
  snapshot(tx: Tx, workspaceId: string, assessmentId: string): Promise<StoredAssessment | null>;
  /** The job's approved rubric version and its competencies' names (the jobs composition's `approvedRubric`). */
  approvedRubric(
    tx: Tx,
    workspaceId: string,
    jobId: string,
  ): Promise<{ id: string; competencies: readonly { id: string; name: string }[] } | null>;
  /** The candidate's evidence for the job (the evidence composition's `readEvidenceForJobAsSystem`). */
  evidence(tx: Tx, workspaceId: string, candidateId: string, jobId: string): Promise<EvidenceItemView[]>;
  /** The person's identifiers the AI client replaces in every source (ADR-006 point 7); null for no such person. */
  identifiersOf(tx: Tx, workspaceId: string, candidateId: string): Promise<Identifiers | null>;
  /** One `decisions.summariseMember` call: its answer, or why there is none. */
  summarise(input: {
    workspaceId: string;
    sources: SummarySource[];
    identifiers: Identifiers;
  }): Promise<{ promptVersion: string; answer: SummaryAnswer } | 'failed' | 'budget_exceeded'>;
  /** Asks for the whole pack again at `at` (the daily AI budget's reset); members already summarised are skipped. */
  retryAt(workspaceId: string, pack: { packId: string; jobId: string }, at: Date): Promise<void>;
  now(): Date;
};

/** 00:05 UTC the next day: the daily AI token budget has reset by then (AIV-P1-089). */
export const budgetResetAt = (now: Date): Date =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 5));

// The model refers to the candidate by the client's placeholder; the card says "the candidate".
const CANDIDATE = /\[CANDIDATE\]/g;

/** The answer with each citation resolved to its evidence item (or the facts) and label. */
function toSummary(answer: SummaryAnswer, sources: readonly SummarySource[]): MemberSummary {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const cite = (citations: Answered['citations']) =>
    citations.flatMap(({ sourceId, quote }) => {
      const source = byId.get(sourceId);
      return source ? [{ itemId: sourceId === FACTS_ID ? null : sourceId, label: source.label, quote }] : [];
    });
  const statement = (s: Answered): CitedStatement => ({
    text: s.text.replace(CANDIDATE, 'the candidate').replace(/^\s*\p{L}/u, (c) => c.toUpperCase()),
    citations: cite(s.citations),
  });
  return {
    strengths: answer.strengths.map(statement),
    risks: answer.risks.map(statement),
    round1: answer.round1 && statement(answer.round1),
    recommendation: {
      action: answer.recommendation.action,
      focus: answer.recommendation.focus?.replace(CANDIDATE, 'the candidate') ?? null,
      citations: cite(answer.recommendation.citations),
    },
  };
}

/**
 * The worker job `decisions.pack.summarise` (AIV-P2-011): for each member of the pack with no summary yet, one
 * `decisions.summariseMember` call on the snapshot they joined with, stored once. A member whose snapshot, rubric
 * version or person cannot be read, or whose answer is rejected (a citation outside their sources, off the schema) or
 * never comes, is stored `unavailable`. A spent daily AI budget stores nothing more and asks again after the reset.
 * It recommends only: it moves no stage, records no decision and contacts nobody (AGENTS.md 1.5).
 */
export async function summarisePack(ports: SummaryPorts, tx: Tx, workspaceId: string, packId: string) {
  const store = ports.storeFor(tx);
  const pack = await store.findPack(workspaceId, packId);
  if (!pack) return;
  const done = new Set((await store.listSummaries(workspaceId, packId)).map((s) => s.candidateId));
  const rubric = await ports.approvedRubric(tx, workspaceId, pack.jobId);
  // Every snapshot is on the pack's rubric version; once another is approved its competencies have no names here.
  // shortcut: such a pack's members are stored unavailable; read the version by id when the jobs contract offers it.
  const names = rubric?.id === pack.rubricVersionId ? new Map(rubric.competencies.map((c) => [c.id, c.name])) : null;
  for (const member of await store.listMembers(workspaceId, packId)) {
    if (done.has(member.candidateId)) continue;
    const row = (summary: Pick<StoredMemberSummary, 'status' | 'promptVersion' | 'summary'>) =>
      store.insertSummary({ workspaceId, packId, candidateId: member.candidateId, createdAt: ports.now(), ...summary });
    const unavailable = () => row({ status: 'unavailable', promptVersion: null, summary: null });
    const snapshot = names && (await ports.snapshot(tx, workspaceId, member.assessmentId));
    const identifiers = snapshot && (await ports.identifiersOf(tx, workspaceId, member.candidateId));
    if (!names || !snapshot || !identifiers) {
      await unavailable();
      continue;
    }
    const sources = sourcesOf(
      snapshot.competencies,
      names,
      await ports.evidence(tx, workspaceId, member.candidateId, pack.jobId),
    );
    const result = await ports.summarise({ workspaceId, sources, identifiers });
    if (result === 'budget_exceeded')
      return ports.retryAt(workspaceId, { packId, jobId: pack.jobId }, budgetResetAt(ports.now()));
    if (result === 'failed') await unavailable();
    else
      await row({ status: 'ready', promptVersion: result.promptVersion, summary: toSummary(result.answer, sources) });
  }
}
