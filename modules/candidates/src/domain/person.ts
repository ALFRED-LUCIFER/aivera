// One person per workspace, however many jobs they apply to. Identity and contact facts only: scores stay with each
// job's rubric (AIV-P1-016).

export const IDENTIFIER_TYPES = ['email', 'phone', 'cv_hash', 'github_login'] as const;
export type IdentifierType = (typeof IDENTIFIER_TYPES)[number];

/** A way to recognise the same person again. Stored normalised, unique per workspace. */
export type Identifier = { type: IdentifierType; value: string };

/** What intake stores until the CV names the applicant (AIV-P1-090); only a person with this name is renamed from a CV. */
export const UNNAMED_APPLICANT = 'Unnamed applicant';

export type Person = {
  id: string;
  workspaceId: string;
  displayName: string;
  emails: string[];
  phones: string[];
  location: string | null;
  /** Demo and test people (AGENTS.md 1.1). */
  synthetic: boolean;
  /** Set while this person is merged into another (AIV-P1-018); cleared by an undo. */
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
  not_synthetic: 'Only a synthetic workspace holding only synthetic people can be purged.',
  merge_people: 'Pick two different people in this workspace, neither merged already.',
  merge_reason: 'Give the reason, in at most 500 characters.',
  name_too_long: "Shorten the person's name to 200 characters or fewer.",
  name_reason: 'Give the reason for the correction, in at most 500 characters.',
  person_not_found: 'That person was not found.',
  merge_not_found: 'That merge was not found or is already undone.',
  undo_expired: 'This merge can no longer be undone.',
  undo_blocked: 'The person this one was merged into has been merged since; undo that merge first.',
} as const;

/** The longest merge, undo or name-correction reason. */
export const MERGE_REASON_MAX = 500;

/** The longest name a person corrects a display name to (AIV-P1-165). */
export const NAME_MAX = 200;

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

/**
 * Normalised, without repeats and in one fixed order, so two arrivals inserting the same identifiers take their
 * locks in the same order; throws `no_identifiers` when there are none.
 */
export function normaliseIdentifiers(identifiers: Identifier[]): Identifier[] {
  const unique = new Map(identifiers.map(normaliseIdentifier).map((i) => [`${i.type}:${i.value}`, i]));
  if (unique.size === 0) throw new CandidateError('no_identifiers');
  return [...unique].toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, i]) => i);
}
