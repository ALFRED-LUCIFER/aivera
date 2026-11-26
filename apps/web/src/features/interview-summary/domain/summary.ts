import {
  includedByDefault as included,
  type Finding,
  type SummaryPreview,
  type SummaryStatus,
} from '@credalent/interviews';
import { z } from 'zod';

// The meeting-summary panel on the interview page (AIV-P1-115) as the server hands it to the browser. Pure. The rules
// (the 12,000-character bound, what a finding proposes, who may act) are the interviews module's.

type Strength = 'strong' | 'medium' | 'supporting' | 'claim';

export type SummaryProposal = {
  competencyId: string;
  name: string;
  finding: Finding;
  /** The summary's own words the finding cites; null when the summary does not cover the competency. */
  excerpt: string | null;
  /** The model's reason: what the person's own reason starts from. */
  reason: string | null;
  /** The competency's strength before and after; null when the proposal changes nothing or cannot be previewed now. */
  change: { from: Strength | null; to: Strength | null } | null;
  /** "Already changed by the scorecard": excluded by default. */
  alreadyChanged: boolean;
};

/** The panel's data: `summary` null before anything was pasted. Never the summary's text. */
export type SummaryPanel = {
  interviewId: string;
  summary: {
    summaryId: string;
    status: SummaryStatus;
    unusual: boolean;
    proposals: SummaryProposal[];
    preview: SummaryPreview | null;
    previewUnavailable: boolean;
  } | null;
};

/** What a panel action answers: the panel as it is now, or why nothing happened (a key of `interviewSummary.errors`). */
export type SummaryOutcome = { panel: SummaryPanel } | { error: SummaryErrorKey };

export const SUMMARY_ERROR_KEYS = [
  'summary_empty',
  'summary_too_long',
  'summary_pending',
  'interview_not_held',
  'preview_changed',
  'failed',
] as const;
export type SummaryErrorKey = (typeof SUMMARY_ERROR_KEYS)[number];

/** A refusal's code as a message key; anything the panel has no words for reads "That did not go through". */
export const errorKey = (code: string): SummaryErrorKey =>
  (SUMMARY_ERROR_KEYS as readonly string[]).includes(code) ? (code as SummaryErrorKey) : 'failed';

/**
 * The changes ticked when the proposals first show: each one that changes something the scorecard has not changed,
 * unless it lowers the evidence (the interviews module's rule, AIV-P1-138).
 */
export const includedByDefault = (proposals: readonly SummaryProposal[]) =>
  proposals.filter(included).map((p) => p.competencyId);

/**
 * The model's reason as the person's starting text, with the placeholders the redaction put in ("[CANDIDATE]",
 * "[PERSON]", "[EMAIL_1]", "[PHONE_1]", "[REMOVED]") taken out, so none reaches the audit note the reason becomes.
 */
export const reasonDraft = (reason: string | null) =>
  (reason ?? '')
    .replace(/\s*\[(?:CANDIDATE|PERSON|REMOVED|EMAIL_\d+|PHONE_\d+)\]/g, '')
    .replace(/^\s*[,;:]?\s*/, '')
    .trim();

// What the browser sends, checked again in the interviews module (AGENTS.md 3.7). The text's bound is the module's
// `summaryTextSchema`; here it is only kept from being unbounded.
export const submitInput = z.strictObject({ interviewId: z.uuid(), text: z.string().max(100_000) });
export const previewInput = z.strictObject({
  summaryId: z.uuid(),
  competencyIds: z.array(z.uuid()).min(1).max(50),
});
export const applyInput = z.strictObject({
  interviewId: z.uuid(),
  summaryId: z.uuid(),
  previewId: z.string().min(1).max(200),
  changes: z
    .array(z.strictObject({ competencyId: z.uuid(), reason: z.string().trim().min(1).max(1000) }))
    .min(1)
    .max(50),
});
export const declineInput = z.strictObject({ interviewId: z.uuid(), summaryId: z.uuid() });
