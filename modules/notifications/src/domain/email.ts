import { z } from 'zod';

// Pure rules of the notifications module (AIV-P0-017): which templates exist, what data each needs, and the send log's
// states. No I/O here.

/** The evidence request a recruiter confirmed (EEvidence artboard). Every field is shown to the candidate only. */
export const evidenceRequestData = z.strictObject({
  jobTitle: z.string().min(1),
  items: z
    .array(
      z.strictObject({
        competency: z.string().min(1),
        /** The candidate's own claim, quoted and highlighted as the cited evidence; optional. */
        claim: z.string().min(1).optional(),
        /** What would show it, in the recruiter's words. */
        ask: z.string().min(1),
      }),
    )
    .min(1),
  /** The candidate's upload page: an opaque id and a signed token only (AGENTS.md 1.2). */
  link: z.url({ protocol: /^https$/ }),
  /** The signed "Ask us to delete your data" link. */
  deleteUrl: z.url({ protocol: /^https$/ }),
});
export type EvidenceRequestData = z.infer<typeof evidenceRequestData>;

/** The recruiter an email is sent for: named in it, and its replies go to their work email. */
export const senderSchema = z.strictObject({
  name: z.string().min(1),
  /** "Questions? Reply to this email and it goes to {shortName}." */
  shortName: z.string().min(1),
  email: z.email(),
  workspace: z.string().min(1),
});
export type Sender = z.infer<typeof senderSchema>;

/** An invitation to join a workspace (EInvite and ERoles artboards, AIV-P1-003). Sent to a member, never a candidate. */
export const memberInvitationData = z.strictObject({
  role: z.enum(['admin', 'recruiter', 'hiring_owner', 'interviewer']),
  /** Hiring owners and interviewers: the jobs they are invited to, already named; null for the whole workspace. */
  scope: z.string().min(1).nullable(),
  expiresAt: z.date(),
  /** The accept page: an opaque workspace id and a random token in the query string only (AGENTS.md 1.2). http only
   * for a local or end-to-end origin; deployed origins are https (AUTH_URL). */
  link: z.url({ protocol: /^https?$/ }),
});
export type MemberInvitationData = z.infer<typeof memberInvitationData>;

/** A member's link into the app (a job's rubric page): opaque ids only. http only for a local or end-to-end origin. */
const appLink = z.url({ protocol: /^https?$/ });
const rubricVersion = { jobTitle: z.string().min(1), version: z.int().min(1), link: appLink };

/** A rubric version sent for the hiring owner's approval (ERubric artboard, AIV-P1-014). Sent to a member. */
export const rubricApprovalData = z.strictObject({
  ...rubricVersion,
  competencies: z
    .array(
      z.strictObject({
        name: z.string().min(1),
        weightPercent: z.int().min(1).max(100),
        levelNeeded: z.int().min(1).max(5),
      }),
    )
    .min(1),
  /** What changed since the approved version it would replace; null when none is approved yet or nothing is noted. */
  changes: z.strictObject({ since: z.int().min(1), note: z.string().min(1) }).nullable(),
});
export type RubricApprovalData = z.infer<typeof rubricApprovalData>;

/** The hiring owner approved the version the recruiter sent (EApproved artboard, AIV-P1-014). */
export const rubricApprovedData = z.strictObject({ ...rubricVersion, approvedAt: z.date() });
export type RubricApprovedData = z.infer<typeof rubricApprovedData>;

/** The hiring owner returned the version with a note (EReturned artboard, AIV-P1-014). */
export const rubricReturnedData = z.strictObject({
  ...rubricVersion,
  note: z.string().min(1).max(1000),
  /** Whether an earlier approved version stays in force. */
  inForce: z.boolean(),
});
export type RubricReturnedData = z.infer<typeof rubricReturnedData>;

/** Each template's data schema. A later ticket adds its template here and in infrastructure/templates. */
export const TEMPLATES = {
  'evidence-request': evidenceRequestData,
  'member-invitation': memberInvitationData,
  'rubric-approval': rubricApprovalData,
  'rubric-approved': rubricApprovedData,
  'rubric-returned': rubricReturnedData,
} as const;
export type TemplateName = keyof typeof TEMPLATES;
export type TemplateData = { [T in TemplateName]: z.infer<(typeof TEMPLATES)[T]> };

export const MESSAGE_STATUSES = ['queued', 'sent', 'failed', 'bounced'] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

/**
 * ACS delivery report status -> the send log's status; undefined leaves the row as it is (Delivered, Expanded). A
 * suppressed address bounced before; quarantine and spam filtering are failures the recruiter should see.
 */
export function statusForDelivery(deliveryStatus: string): MessageStatus | undefined {
  if (deliveryStatus === 'Bounced' || deliveryStatus === 'Suppressed') return 'bounced';
  if (deliveryStatus === 'Failed' || deliveryStatus === 'Quarantined' || deliveryStatus === 'FilteredSpam')
    return 'failed';
  return undefined;
}

export type EmailErrorCode = 'no_cause' | 'invalid_data' | 'unknown_template' | 'invalid_address';

const MESSAGES: Record<EmailErrorCode, string> = {
  no_cause: 'Every email needs the action that caused it',
  invalid_data: 'The template data is missing or invalid',
  unknown_template: 'There is no such email template',
  invalid_address: 'The recipient or reply-to address is not valid',
};

/** Refused before anything is written. `fields` names the template fields at fault, never their values. */
export class EmailError extends Error {
  override name = 'EmailError';
  readonly code: EmailErrorCode;
  readonly fields: string[];
  constructor(code: EmailErrorCode, fields: string[] = []) {
    super(fields.length ? `${MESSAGES[code]}: ${fields.join(', ')}` : MESSAGES[code]);
    this.code = code;
    this.fields = fields;
  }
}
