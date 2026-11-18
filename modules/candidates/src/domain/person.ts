// One person per workspace, however many jobs they apply to. Identity and contact facts only: scores stay with each
// job's rubric (AIV-P1-016).

export const IDENTIFIER_TYPES = ['email', 'phone', 'cv_hash', 'github_login'] as const;
export type IdentifierType = (typeof IDENTIFIER_TYPES)[number];

/** A way to recognise the same person again. Stored normalised, unique per workspace. */
export type Identifier = { type: IdentifierType; value: string };

export type Person = {
  id: string;
  workspaceId: string;
  displayName: string;
  emails: string[];
  phones: string[];
  location: string | null;
  /** Demo and test people (AGENTS.md 1.1). */
  synthetic: boolean;
  /** Set when duplicate merge (AIV-P1-018) folds this person into another. */
  mergedIntoId: string | null;
  createdAt: Date;
};

/**
 * Field names in this module's contract that hold candidate personal data (AGENTS.md 1.2), for the telemetry scrubber
 * (AIV-P0-018) to register. Never log them.
 */
export const PERSONAL_DATA_FIELDS = ['displayName', 'emails', 'phones', 'location', 'identifiers'] as const;

const MESSAGES = {
  invalid_identifier: 'An identifier is not a valid email, phone, CV hash or GitHub login',
  no_identifiers: 'A person needs at least one identifier',
  display_name: "Enter the person's name.",
  not_synthetic: 'The workspace holds people who are not synthetic, so it cannot be purged.',
} as const;

export type CandidateErrorCode = keyof typeof MESSAGES;

/** A refused candidates operation. The message never repeats the value that was refused (AGENTS.md 1.2). */
export class CandidateError extends Error {
  readonly code: CandidateErrorCode;
  constructor(code: CandidateErrorCode) {
    super(MESSAGES[code]);
    this.name = 'CandidateError';
    this.code = code;
  }
}

const VALID: Record<IdentifierType, RegExp> = {
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  // E.164: a country code and at most 15 digits.
  phone: /^\+[1-9]\d{6,14}$/,
  // SHA-256 of the CV file, hex.
  cv_hash: /^[0-9a-f]{64}$/,
  github_login: /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$/,
};

const NORMALISE: Record<IdentifierType, (value: string) => string> = {
  email: (v) => v.trim().toLowerCase(),
  phone: (v) => v.replace(/[\s().-]/g, '').replace(/^00/, '+'),
  cv_hash: (v) => v.trim().toLowerCase(),
  github_login: (v) => v.trim().replace(/^@/, '').toLowerCase(),
};

/** "Sara.AlQahtani@Example.test" -> "sara.alqahtani@example.test", "+971 50 000 0001" -> "+971500000001". */
export function normaliseIdentifier({ type, value }: Identifier): Identifier {
  const normalised = NORMALISE[type](value);
  if (!VALID[type].test(normalised)) throw new CandidateError('invalid_identifier');
  return { type, value: normalised };
}

/** Normalised and without repeats; throws `no_identifiers` when there are none. */
export function normaliseIdentifiers(identifiers: Identifier[]): Identifier[] {
  const unique = new Map(identifiers.map(normaliseIdentifier).map((i) => [`${i.type}:${i.value}`, i]));
  if (unique.size === 0) throw new CandidateError('no_identifiers');
  return [...unique.values()];
}
