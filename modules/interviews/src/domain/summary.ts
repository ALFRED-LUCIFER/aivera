// A pasted meeting summary and what it proposes (AIV-P1-115). Pure: the model only says what the summary shows for a
// competency; these rules decide what is proposed, and nothing is applied until a person confirms (AGENTS.md 1.5).
import { z } from 'zod';
import type { Rating } from './scorecard.ts';

export const SUMMARY_MAX_CHARS = 12_000;

/** Plain text, 1 to 12,000 characters once trimmed. The messages are `InterviewError` codes. */
export const summaryTextSchema = z.string().trim().min(1, 'summary_empty').max(SUMMARY_MAX_CHARS, 'summary_too_long');

/** What the summary shows for a competency: the scorecard's ratings, and `not_mentioned` when it says nothing. */
export const FINDINGS = ['not_mentioned', 'not_shown', 'partly_shown', 'clearly_shown', 'strongly_shown'] as const;
export type Finding = (typeof FINDINGS)[number];

/**
 * `analysing` until the worker stores the proposals (`proposed`), `waiting` while the workspace's daily AI budget is
 * spent, `failed` when the model's answer was rejected twice or the model is unavailable; then a person applies or
 * declines, once.
 */
export const SUMMARY_STATUSES = ['analysing', 'waiting', 'failed', 'proposed', 'applied', 'declined'] as const;
export type SummaryStatus = (typeof SUMMARY_STATUSES)[number];

export const PROPOSAL_STATUSES = ['proposed', 'applied', 'declined'] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export type ProposedStrength = 'claim' | 'medium';

// SAFETY: the same scale as the scorecard, and Strongly shown is capped at Medium: a summary is the interviewer's
// word, not inspected work, so nothing it says ("verified by his former manager") proposes Strong (AGENTS.md 1.6).
const PROPOSED: Record<Finding, ProposedStrength | null> = {
  not_mentioned: null,
  not_shown: 'claim',
  partly_shown: null,
  clearly_shown: 'medium',
  strongly_shown: 'medium',
};

/** The strength a finding proposes: Claim only, Medium, or null for no change. */
export const proposedStrength = (finding: Finding): ProposedStrength | null => PROPOSED[finding];

/** The rating the shared score change takes for a finding that proposes a change; null when it proposes none. */
export const ratingOf = (finding: Finding): Rating | null => (PROPOSED[finding] ? (finding as Rating) : null);

export type MeetingSummary = {
  id: string;
  workspaceId: string;
  interviewId: string;
  /** The member who pasted it: a workspace member is named by their user id. */
  authorUserId: string;
  text: string;
  status: SummaryStatus;
  /** The summary holds text aimed at an AI or a reviewer: "Unusual content in this summary". It changes nothing. */
  unusual: boolean;
  /** The prompt the proposals came from; null until analysed. */
  promptVersion: string | null;
  createdAt: Date;
};

export type Proposal = {
  competencyId: string;
  finding: Finding;
  /** The summary's own words the finding rests on, and where they are in it; null when `not_mentioned`. */
  excerpt: string | null;
  excerptStart: number | null;
  excerptEnd: number | null;
  /** The model's reason, at most 40 words; null when `not_mentioned`. */
  reason: string | null;
  proposedStrength: ProposedStrength | null;
  status: ProposalStatus;
};

type Span = { start: number; end: number };

/** One finding of the model's checked answer: the competency by its id, and its excerpt as a span of the summary. */
export type SummaryFinding = {
  competencyId: string;
  finding: Exclude<Finding, 'not_mentioned'>;
  reason: string;
  excerpt: Span & { quote: string };
};

/**
 * One proposal per competency the interview tests, in the interview's order. A competency the answer leaves out is
 * `not_mentioned` ("not covered in the summary · stays a gap"); so is one whose excerpt lies in text aimed at the AI
 * (`unusual`), so an instruction in the summary proposes nothing. A finding for any other competency is dropped.
 */
export function toProposals(
  competencyIds: readonly string[],
  findings: readonly SummaryFinding[],
  unusual: readonly Span[],
): Proposal[] {
  return competencyIds.map((competencyId) => {
    const found = findings.find((f) => f.competencyId === competencyId);
    const aimedAtAi = found && unusual.some((u) => found.excerpt.start < u.end && found.excerpt.end > u.start);
    if (!found || aimedAtAi)
      return {
        competencyId,
        finding: 'not_mentioned',
        excerpt: null,
        excerptStart: null,
        excerptEnd: null,
        reason: null,
        proposedStrength: null,
        status: 'proposed',
      };
    return {
      competencyId,
      finding: found.finding,
      excerpt: found.excerpt.quote,
      excerptStart: found.excerpt.start,
      excerptEnd: found.excerpt.end,
      reason: found.reason,
      proposedStrength: proposedStrength(found.finding),
      status: 'proposed',
    };
  });
}

/**
 * "Already changed by the scorecard": the interview has rated the competency before (`replaces`, from the assessment's
 * stored interview changes) and no applied summary of this interview did it. Such a proposal is excluded by default.
 */
export const changedByScorecard = (replaces: Rating | null, appliedBySummary: boolean) =>
  replaces !== null && !appliedBySummary;

/**
 * How long an analysis may run: well past the worker's last delivery (10 deliveries, at most 30 s apart) and the
 * model's own retry. A summary still `analysing` after it was dead-lettered.
 */
export const ANALYSIS_BOUND_MS = 15 * 60_000;

/**
 * The status a person sees and acts on: `failed` for a summary left `analysing` past the bound, so the page stops
 * asking and a new summary may be pasted.
 */
// shortcut: a dead-lettered analysis reads failed only after the bound, and a `waiting` summary whose next-day run is
// dead-lettered stays waiting; the bound starts at paste time, so a queue backlog longer than it shows "could not be
// analysed" until the analysis lands. Mark the summary failed on the consumer's last delivery when it offers that hook.
export const shownStatus = (summary: Pick<MeetingSummary, 'status' | 'createdAt'>, now: Date): SummaryStatus =>
  summary.status === 'analysing' && now.getTime() - summary.createdAt.getTime() > ANALYSIS_BOUND_MS
    ? 'failed'
    : summary.status;

/** 00:05 UTC on the day after `now`: when work held back by the daily AI budget runs again (AIV-P1-089). */
export const budgetResetAt = (now: Date): Date =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 5));
