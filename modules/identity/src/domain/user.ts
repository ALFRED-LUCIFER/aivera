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
  /** True only when the provider said so (`email_verified: true`); anything else is unverified. */
  emailVerified: boolean;
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

/** Emails compare case-insensitively; the database enforces the lower-case form (check constraint). */
export const normalizeEmail = (email: string): string => email.trim().toLowerCase();
