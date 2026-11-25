// A decision pack: a selection of one job's candidates, each with a snapshot of their assessment when the pack was
// prepared, and the hiring owner's decision per candidate (AIV-P2-009). A person decides; nothing here advances,
// rejects or contacts anyone (AGENTS.md 1.5).

/** `draft` is not written yet: a pack is created ready, with its members (AIV-P2-010 may save drafts from the ranking). */
export const STATUSES = ['draft', 'ready', 'decided'] as const;
export type PackStatus = (typeof STATUSES)[number];

/** The hiring owner's decision. */
export const DECISIONS = ['advance', 'hold', 'do_not_advance'] as const;
export type DecisionValue = (typeof DECISIONS)[number];

export const NAME_MAX = 120;
export const NOTE_MAX = 1000;

export type DecisionPack = {
  id: string;
  workspaceId: string;
  jobId: string;
  /** The job's approved rubric version when the pack was prepared; every member's snapshot is on it. */
  rubricVersionId: string;
  /** "Round 2 shortlist: Senior AI Engineer". */
  name: string;
  preparedBy: string;
  preparedAt: Date;
  status: PackStatus;
};

/** One candidate in a pack. Written once and never changed: the scores are those in front of the hiring owner. */
export type PackMember = {
  workspaceId: string;
  packId: string;
  /** The candidates module's opaque person id. */
  candidateId: string;
  /** The assessment module's stored result this snapshot was taken from. */
  assessmentId: string;
  backedScore: number;
  /** "up to N if claims hold". */
  upperBound: number;
  /** The order in the pack, from 0. */
  position: number;
};

export type Decision = {
  workspaceId: string;
  packId: string;
  candidateId: string;
  decision: DecisionValue;
  decidedBy: string;
  decidedAt: Date;
  /** Why: required, and written to the audit log with the decision. */
  note: string;
};

/**
 * Who may record a pack's decisions: the hiring owner named on the job, while they still hold that role. The role and
 * job grant are checked by `decision.record` first; this narrows it, so an admin, a recruiter or another hiring owner
 * on the job may not decide.
 * shortcut: no delegated authority; nothing in the workspace model records a delegation yet, add it here when one does.
 */
export const mayDecide = (user: { userId: string; role: string }, job: { hiringOwnerUserId: string | null }) =>
  user.role === 'hiring_owner' && job.hiringOwnerUserId === user.userId;

/** The entries to add: each candidate once, first mention wins, and none already in the pack. */
export function newMembers<T extends { candidateId: string }>(inPack: readonly string[], adding: readonly T[]): T[] {
  const seen = new Set(inPack);
  return adding.filter((m) => !seen.has(m.candidateId) && seen.add(m.candidateId));
}

/** Whether `decided` names every member exactly once and nobody else. */
export const coversMembers = (members: readonly string[], decided: readonly string[]) =>
  decided.length === members.length &&
  new Set(decided).size === decided.length &&
  members.every((id) => decided.includes(id));

const MESSAGES = {
  job_not_found: 'Job not found',
  pack_not_found: 'Decision pack not found',
  rubric_not_approved: "Approve the job's rubric before preparing a decision pack.",
  candidate_not_assessed: 'Every candidate in a pack needs an assessment on the approved rubric.',
  pack_decided: 'The decisions on this pack are already recorded.',
  pack_not_ready: 'This pack is not ready for decisions.',
  decisions_incomplete: 'Record one decision for every candidate in the pack.',
} as const;

export type PackErrorCode = keyof typeof MESSAGES;

/** A refused pack operation. The message never repeats the refused value (AGENTS.md 1.2). */
export class PackError extends Error {
  readonly code: PackErrorCode;
  constructor(code: PackErrorCode) {
    super(MESSAGES[code]);
    this.name = 'PackError';
    this.code = code;
  }
}
