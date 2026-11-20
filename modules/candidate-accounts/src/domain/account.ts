// The candidate's own side of Credalent (ADR-009): an account per identity user, owned by the person, not a workspace.

export const CONSENT_PURPOSES = ['apply_to_job', 'answer_evidence_request', 'cv_check'] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

export const LINK_REASONS = ['applied', 'answered_evidence_request'] as const;
export type LinkReason = (typeof LINK_REASONS)[number];

/** The consent purpose a link reason needs: a link is made only for what the candidate agreed to. */
const PURPOSE_FOR: Record<LinkReason, ConsentPurpose> = {
  applied: 'apply_to_job',
  answered_evidence_request: 'answer_evidence_request',
};

/** The account id is the identity user's id: one account per identity user. Never sent to a workspace. */
export type Account = {
  id: string;
  /** Set at sign-up (AIV-P3-007); null until then. */
  fullName: string | null;
  /** A job type key of the jobs catalogue, checked against the published version at sign-up (ADR-013 point 7). */
  workType: string | null;
  headline: string | null;
  location: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type Consent = {
  id: string;
  accountId: string;
  purpose: ConsentPurpose;
  /** Null only for `cv_check`, which reaches no workspace. */
  workspaceId: string | null;
  jobId: string | null;
  grantedAt: Date;
  /** The version of the exact consent text shown, kept in code with the text. */
  textVersion: string;
  withdrawnAt: Date | null;
};

export type WorkspaceLink = {
  id: string;
  accountId: string;
  workspaceId: string;
  /** The workspace's own candidate record (opaque id from @credalent/candidates). */
  workspaceCandidateId: string;
  reason: LinkReason;
  consentId: string;
  createdAt: Date;
};

/**
 * Field names in this module's contract that hold candidate personal data (AGENTS.md 1.2). apps/web registers them with
 * the telemetry scrubber at start-up (instrumentation.ts), so they are redacted in logs and telemetry. Never log them.
 */
export const PERSONAL_DATA_FIELDS = ['fullName', 'headline', 'location'] as const;

const MESSAGES = {
  text_version: 'A consent needs the version of the text the candidate agreed to.',
  consent_target: 'A consent to apply or answer names its workspace and job; a CV check names neither.',
  consent_not_found: 'No such consent on this account.',
  already_withdrawn: 'This consent is already withdrawn.',
  consent_required: 'Linking to a workspace needs an open consent for that workspace and purpose.',
  full_name: 'A sign-up needs a full name.',
  already_signed_up: 'This account has already signed up.',
} as const;

export type CandidateAccountErrorCode = keyof typeof MESSAGES;

/** A refused candidate-accounts operation. The message carries no personal data (AGENTS.md 1.2). */
export class CandidateAccountError extends Error {
  readonly code: CandidateAccountErrorCode;
  constructor(code: CandidateAccountErrorCode) {
    super(MESSAGES[code]);
    this.name = 'CandidateAccountError';
    this.code = code;
  }
}

/** What sign-up records (AIV-P3-007). Its caller (a server action) validates the shape with zod (AGENTS.md 3.7). */
export type SignUpInput = { fullName: string; workType: string };

/** Signed up once full name and work type are set; until then the account exists only from `withAccount`. */
export const isSignedUp = (account: Pick<Account, 'fullName' | 'workType'>): boolean =>
  account.fullName !== null && account.workType !== null;

/** The full name to store, trimmed; throws when blank. */
export function signUpName(fullName: string): string {
  const name = fullName.trim();
  if (!name) throw new CandidateAccountError('full_name');
  return name;
}

/** Throws unless the consent is well formed: a text version, and a workspace and job exactly when it reaches one. */
export function checkNewConsent(c: Pick<Consent, 'purpose' | 'workspaceId' | 'jobId' | 'textVersion'>): void {
  if (!c.textVersion.trim()) throw new CandidateAccountError('text_version');
  const named = [c.workspaceId, c.jobId].filter((id) => id !== null).length;
  if (named !== (c.purpose === 'cv_check' ? 0 : 2)) throw new CandidateAccountError('consent_target');
}

/** The withdrawal time to record; a withdrawn consent stays withdrawn. */
export function withdrawalAt(consent: Consent, now: Date): Date {
  if (consent.withdrawnAt) throw new CandidateAccountError('already_withdrawn');
  return now;
}

/** Throws unless `consent` is open, for `workspaceId`, and for the purpose `reason` needs. */
export function checkLinkConsent(consent: Consent | null, workspaceId: string, reason: LinkReason): void {
  if (!consent || consent.withdrawnAt || consent.workspaceId !== workspaceId || consent.purpose !== PURPOSE_FOR[reason])
    throw new CandidateAccountError('consent_required');
}
