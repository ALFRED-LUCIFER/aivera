import { DECISIONS, NOTE_MAX, type CitedStatement, type DecisionValue, type MemberSummary } from '@credalent/decisions';
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
  /** The agency client the job is for ("Prepared for Falcon Pay"); null in-house, and for a reader who may not list clients. */
  client: string | null;
  preparedAt: Date;
  /** The approved rubric version the pack is on, or null once the job's approved version has moved on. */
  rubricVersion: number | null;
  /** "What the role needs" and "Competencies and weights" from the pack's rubric version; null once it has moved on. */
  role: { successStatement: string; competencies: { name: string; weightPercent: number }[] } | null;
  /** In reading order: highest backed score first (`byBackedScore`). */
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
  /** Whether the reader is the member named as the job's hiring owner, who alone records the decisions (AIV-P2-012). */
  mayDecide: boolean;
  /**
   * An admin on a job with no hiring owner, who may name themselves and then decide (owner decision (b), AIV-P1-165):
   * a solo recruiter records decisions without a second account. Never offered over a hiring owner already named.
   */
  mayNameSelf: boolean;
  /** Who recorded the decisions and when; null while undecided. `by` is null once that account is gone. */
  decided: { by: string | null; at: Date } | null;
};

/**
 * The pack as the hiring owner will see it (AIV-P1-116): summaries and sources only, never a contact detail, a CV or an
 * evidence file (AGENTS.md 1.9). `workspace` is the workspace's name, for the branded header.
 */
export type PackPreview = Pick<PackPage, 'name' | 'job' | 'client' | 'preparedAt'> & {
  workspace: string;
  members: Pick<PackPage['members'][number], 'candidateId' | 'name' | 'backedScore' | 'upperBound' | 'summary'>[];
};

/** "Backed by evidence" and "Still to test in the interview": a competency proven at the level the job needs, or not. */
export const byNeed = (rows: readonly NeedRow[]) => ({
  strengths: rows.filter((r) => r.proven >= r.needed),
  risks: rows.filter((r) => r.proven < r.needed),
});

/**
 * The pack's reading order (AIV-P1-165): highest backed score first. A tie keeps the order the members joined in: the
 * claim range never breaks it, since a claim counts zero (AGENTS.md 1.6).
 */
export const byBackedScore = <T extends { backedScore: number }>(members: readonly T[]): T[] =>
  members.toSorted((a, b) => b.backedScore - a.backedScore);

/** What separates a member from the one listed above them, in one line: the gap in backed score, or none. */
export type Standing =
  { key: 'first' } | { key: 'level'; name: string } | { key: 'below'; name: string; points: number };

/** `members` in `byBackedScore` order; `name` is the member above, as the page shows it. */
export function standing(members: readonly { backedScore: number }[], index: number, nameAbove: string): Standing {
  const [above, member] = [members[index - 1], members[index]];
  if (!above || !member) return { key: 'first' };
  const points = above.backedScore - member.backedScore;
  return points === 0 ? { key: 'level', name: nameAbove } : { key: 'below', name: nameAbove, points };
}

type Citation = CitedStatement['citations'][number];

/**
 * The distinct sources a card section cites, in the order first cited: a statement's "[2]" is the second one. The
 * assessment's own facts (`itemId` null) are one source.
 */
export function numberedSources(citations: readonly Citation[]): Citation[] {
  const sources = new Map<string | null, Citation>();
  for (const c of citations) if (!sources.has(c.itemId)) sources.set(c.itemId, c);
  return [...sources.values()];
}

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

export type RecordDecisionsResult =
  { ok: true; decidedAt: Date } | { ok: false; error: 'invalid' | 'decided' | 'failed' };

/** An admin naming themselves the job's hiring owner, with the reason audited (AIV-P1-165, owner decision (b)). */
export const nameSelfSchema = z.strictObject({ jobId: z.uuid(), reason: z.string().trim().min(1).max(NOTE_MAX) });

export type NameSelfResult = { ok: true } | { ok: false; error: 'invalid' | 'taken' | 'failed' };

/** What "Record decisions yourself" shows and does; its controller hook builds it. */
export type NameSelfView = {
  /** True while the preview is open. */
  previewing: boolean;
  onOpen: () => void;
  onCancel: () => void;
  reason: string;
  onReasonChange: (reason: string) => void;
  reasonValid: boolean;
  error: 'taken' | 'failed' | null;
  /** Rejects when nothing was saved, so the card shows "Nothing was changed". */
  onConfirm: () => Promise<void>;
};

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
  /** When this person recorded the decisions on this page; from then on the choices are read-only. */
  recordedAt: Date | null;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
};
