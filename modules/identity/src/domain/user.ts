// One user per verified email; each sign-in method (issuer + subject) maps to that user (ADR-009 point 4).

export type User = {
  id: string;
  /** Always verified and stored lower-case: a user is only ever created from a verified email. */
  email: string;
  displayName: string | null;
  createdAt: Date;
};

/** The claims of a validated ID token that identity needs. */
export type IdTokenIdentity = {
  issuer: string;
  subject: string;
  email: string;
  /** The `email_verified` claim as sent; `undefined` when absent (see `isEmailVerified`). */
  emailVerified: boolean | undefined;
  displayName: string | null;
};

const MESSAGES = {
  unverified_email: 'Verify your email to continue.',
} as const;

export type IdentityErrorCode = keyof typeof MESSAGES;

/** A refused sign-in. The message is safe to show and carries no personal data. */
export class IdentityError extends Error {
  readonly code: IdentityErrorCode;
  constructor(code: IdentityErrorCode) {
    super(MESSAGES[code]);
    this.name = 'IdentityError';
    this.code = code;
  }
}

/**
 * Verified when the token says `email_verified: true`, or when it comes from Credalent's own External ID tenant and says
 * nothing: that tenant verifies every email before it creates an account and sends no `email_verified` claim
 * (ADR-009 point 4). An explicit `false` is never trusted, and no other issuer is trusted without the claim.
 */
export const isEmailVerified = (token: IdTokenIdentity, trustedIssuer: string): boolean =>
  token.emailVerified === true || (token.emailVerified === undefined && token.issuer === trustedIssuer);

/** Emails compare case-insensitively; the database enforces the lower-case form (check constraint). */
// shortcut: JS toLowerCase and PostgreSQL lower() can differ for some non-ASCII letters (e.g. U+0130), so such an email
// could fail the lower-case check; normalise the same way in both (or compare in SQL) if internationalised emails appear
export const normalizeEmail = (email: string): string => email.trim().toLowerCase();
