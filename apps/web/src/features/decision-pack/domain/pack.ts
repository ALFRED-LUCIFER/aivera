import { DECISIONS, NOTE_MAX, type DecisionValue, type MemberSummary } from '@credalent/decisions';
import { z } from 'zod';
import type { NeedRow } from '@/features/evidence-profile/domain/needs.ts';

export { DECISIONS, NOTE_MAX, type DecisionValue };

/**
 * A member's card text (AIV-P2-011), written by the worker when they joined: `preparing` until it is, `ready` with the
 * cited strengths, risks, Round 1 finding and Credalent's recommendation, or `unavailable` (no answer with valid
 * citations) with the assessment's own competencies that meet the job's need and those short of it, from the
 * assessment the member joined with (empty once a newer one or another rubric version replaced it).
 */
export type CardSummary =
  | { status: 'preparing' }
  | { status: 'ready'; summary: MemberSummary }
  | { status: 'unavailable'; strengths: NeedRow[]; risks: NeedRow[] };

/** A decision pack page as the server hands it to the browser (AIV-P2-010): plain data, scores as snapshotted. */
export type PackPage = {
  jobId: string;
  packId: string;
  name: string;
  job: string;
  preparedAt: Date;
  /** The approved rubric version the pack is on, or null once the job's approved version has moved on. */
  rubricVersion: number | null;
  /** "What the role needs" and "Competencies and weights" from the pack's rubric version; null once it has moved on. */
  role: { successStatement: string; competencies: { name: string; weightPercent: number }[] } | null;
  members: {
    candidateId: string;
    name: string | null;
    backedScore: number;
    upperBound: number;
    /** Who added the member and when; null on members added before this was stored, or once that account is gone. */
    added: { by: string; at: Date } | null;
    summary: CardSummary;
    /** The hiring owner's recorded decision (AIV-P2-012), or null while none is recorded. */
    decision: DecisionValue | null;
  }[];
  /** The job's other applicants: they stay in the ranking and can be added to a later pack. */
  others: number;
  /** Whether the reader is the job's hiring owner, who alone records the decisions (AIV-P2-012). */
  mayDecide: boolean;
  /** Who recorded the decisions and when; null while undecided. `by` is null once that account is gone. */
  decided: { by: string | null; at: Date } | null;
};

/**
 * The pack as the hiring owner will see it (AIV-P1-116): summaries and sources only, never a contact detail, a CV or an
 * evidence file (AGENTS.md 1.9). `workspace` is the workspace's name, for the branded header.
 */
export type PackPreview = Pick<PackPage, 'name' | 'job' | 'preparedAt'> & {
  workspace: string;
  members: Pick<PackPage['members'][number], 'candidateId' | 'name' | 'backedScore' | 'upperBound' | 'summary'>[];
};

/** "Backed by evidence" and "Still to test in the interview": a competency proven at the level the job needs, or not. */
export const byNeed = (rows: readonly NeedRow[]) => ({
  strengths: rows.filter((r) => r.proven >= r.needed),
  risks: rows.filter((r) => r.proven < r.needed),
});

/** The pack page's states: loading.tsx and error.tsx render the first two. */
export type DecisionPackView =
  { status: 'loading' } | { status: 'error'; onRetry: () => void } | { status: 'ready'; pack: PackPage };

/** One undecided pack on the job's Decision tab. */
export type PackLink = { id: string; name: string; members: number };

/**
 * The hiring owner's confirmed decisions (AIV-P2-012): one per member, and one reason, written to each decision's audit
 * entry. The server action validates it with this schema; the decisions module checks it again.
 */
export const recordDecisionsSchema = z.strictObject({
  packId: z.uuid(),
  decisions: z
    .array(z.strictObject({ candidateId: z.uuid(), decision: z.enum(DECISIONS) }))
    .min(1)
    .max(50),
  reason: z.string().trim().min(1).max(NOTE_MAX),
});

export type RecordDecisionsResult = { ok: true } | { ok: false; error: 'invalid' | 'decided' | 'failed' };

/** The members with no decision chosen, in pack order: "Choose a decision for Huda Al Mansoori". */
export const undecided = (
  members: readonly Pick<PackPage['members'][number], 'candidateId'>[],
  choices: Readonly<Record<string, DecisionValue>>,
) => members.filter((m) => !choices[m.candidateId]).map((m) => m.candidateId);

/** What "Record the decision" shows and does; the controller hook builds it and the components only render it. */
export type RecordView = {
  /** The decision chosen per candidate id; none is chosen for anyone at first (the recommendation decides nothing). */
  choices: Readonly<Record<string, DecisionValue>>;
  onChoose: (candidateId: string, decision: DecisionValue) => void;
  /** Members with no decision, once "Record decisions" was chosen. */
  missing: readonly string[];
  onRecord: () => void;
  /** True while the preview is open. */
  previewing: boolean;
  reason: string;
  onReasonChange: (reason: string) => void;
  reasonValid: boolean;
  error: 'decided' | 'failed' | null;
  /** True once this person recorded the decisions on this page. */
  recorded: boolean;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
};
