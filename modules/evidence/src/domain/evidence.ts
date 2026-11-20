// Everything a score can rest on (AIV-P1-024): where a piece of evidence came from, the excerpt it cites, how far it
// is confirmed (provenance), how much it can carry (strength) and what it does not show (limit). The values are the
// ones `ProvenanceTag` and `StrengthMeter` of @credalent/ui take, so a screen passes them through unchanged.

export const SOURCE_KINDS = [
  'cv',
  'repository',
  'document',
  'shipped_product',
  'reference_call',
  'portal_submission',
  'interview_note',
] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/** Independently corroborated, Candidate-submitted, Claim awaiting validation, Contradictory, Awaiting live defence. */
export const PROVENANCES = ['corroborated', 'submitted', 'claim', 'contradictory', 'awaiting-defence'] as const;
export type Provenance = (typeof PROVENANCES)[number];

/**
 * The Rubric page's scoring definitions. Strong: real work, authorship clear, checked by a second source. Medium: real
 * work, but authorship or scale is unclear. Supporting: an indirect signal (a reference, a talk, a public post).
 * Claim only: stated, with nothing to inspect; it counts zero in the backed score (scoring, AIV-P1-030).
 */
export const STRENGTHS = ['strong', 'medium', 'supporting', 'claim'] as const;
export type Strength = (typeof STRENGTHS)[number];

/** Provenances that are still only the candidate's word: never stronger than Supporting. */
const UNPROVEN: readonly Provenance[] = ['claim', 'awaiting-defence'];
const UNPROVEN_STRENGTHS: readonly Strength[] = ['supporting', 'claim'];

/** Where evidence came from: a link, a stored file, or neither (a reference call, interview notes). */
export type EvidenceSource = {
  id: string;
  workspaceId: string;
  candidateId: string;
  kind: SourceKind;
  /** How the citation names it: "llm-eval-harness", "CV", "Reference call". */
  label: string;
  url: string | null;
  blobFileId: string | null;
  capturedAt: Date;
  /** When and how it was last checked ("Commit history"); null while unchecked. */
  checkedAt: Date | null;
  checkMethod: string | null;
  synthetic: boolean;
  createdAt: Date;
  /** The SimHash of the source's text (domain/fingerprint.ts); null when there was no text or too little signal. */
  textFingerprint: string | null;
};

/**
 * A link from an item to a competency of a job's rubric (ids of the jobs module, opaque here), with the level 0–5 the
 * item shows for that competency (AIV-P1-030 scores it; 0 shows nothing).
 */
export type CompetencyLink = { jobId: string; competencyId: string; level: number };

export type EvidenceItem = {
  id: string;
  workspaceId: string;
  sourceId: string;
  candidateId: string;
  /** The exact text the evidence rests on: "authored 412 of 460 commits". */
  excerpt: string;
  /** Where in the source: "page 2", a commit range; null when the excerpt is the whole source. */
  excerptSpan: string | null;
  provenance: Provenance;
  strength: Strength;
  /** What this evidence does not show (AGENTS.md 1.6). */
  limit: string;
  synthetic: boolean;
  createdAt: Date;
};

/**
 * Field names in this module's contract that hold candidate personal data (AGENTS.md 1.2), for the telemetry scrubber
 * (AIV-P0-018) to register once apps/web first builds this module (as instrumentation.ts does for candidates).
 * Never log them.
 */
export const PERSONAL_DATA_FIELDS = [
  'label',
  'url',
  'checkMethod',
  'excerpt',
  'excerptSpan',
  'limit',
  'githubLogin',
  'emails',
  'repository',
  'mergedBy',
  // Repository file paths and what was found in them (AIV-P1-072).
  'path',
  'detail',
  'citations',
] as const;

const MESSAGES = {
  source_kind: 'The source kind is not one of the listed kinds',
  source_label: 'Name the source',
  source_url: 'A source link must be an https address',
  repository_url: 'A repository link must be https://github.com/ followed by the owner and the repository',
  github_login: 'The GitHub login is not valid',
  excerpt: 'Quote the excerpt the evidence rests on',
  no_items: 'Record at least one item the source backs',
  provenance: 'The provenance is not one of the listed values',
  strength: 'The strength is not one of the listed values',
  claim_strength: 'A claim cannot be stronger than Supporting',
  limit: 'State what this evidence does not show',
  level: 'A level is a whole number from 0 to 5',
  not_found: 'No such evidence item',
  flag_not_found: 'No such flag',
  resolution: 'Choose a reason from the list',
  not_synthetic: 'Only a synthetic workspace holding only synthetic evidence can be purged.',
  nothing_to_request: 'Nothing rests on a claim for this job',
  request_not_found: 'No such evidence request',
  request_status: 'This request cannot move to that status',
  open_request: 'This candidate already has an open request for this job',
} as const;

export type EvidenceErrorCode = keyof typeof MESSAGES;

/** A refused evidence operation. The message never repeats the value that was refused (AGENTS.md 1.2). */
export class EvidenceError extends Error {
  readonly code: EvidenceErrorCode;
  constructor(code: EvidenceErrorCode) {
    super(MESSAGES[code]);
    this.name = 'EvidenceError';
    this.code = code;
  }
}

const isOneOf = <T extends string>(list: readonly T[], value: string): value is T => list.includes(value as T);

// shortcut: no rule ties the kind to its locator (a repository needs a url; not both url and blobFileId); it arrives with
// the readers that set them (AIV-P1-026, AIV-P1-028).
/** Throws `EvidenceError` unless the source can be stored. */
export function checkSource(source: Pick<EvidenceSource, 'kind' | 'label' | 'url'>): void {
  if (!isOneOf(SOURCE_KINDS, source.kind)) throw new EvidenceError('source_kind');
  if (!source.label.trim()) throw new EvidenceError('source_label');
  // https only, so a stored link can never become a javascript: or plain-http link on a screen.
  if (source.url !== null && URL.parse(source.url)?.protocol !== 'https:') throw new EvidenceError('source_url');
}

/** Throws `EvidenceError('level')` unless the link's level is a whole number from 0 to 5. */
export function checkLink(link: Pick<CompetencyLink, 'level'>): void {
  if (!Number.isInteger(link.level) || link.level < 0 || link.level > 5) throw new EvidenceError('level');
}

/** Throws `EvidenceError('no_items')` when a source backs nothing: evidence is the items, not the source alone. */
export function checkItems(items: readonly unknown[]): void {
  if (items.length === 0) throw new EvidenceError('no_items');
}

/** Throws `EvidenceError` unless the item can be stored: closed lists, a limit, and a claim at most Supporting. */
export function checkItem(item: Pick<EvidenceItem, 'excerpt' | 'provenance' | 'strength' | 'limit'>): void {
  if (!item.excerpt.trim()) throw new EvidenceError('excerpt');
  if (!isOneOf(PROVENANCES, item.provenance)) throw new EvidenceError('provenance');
  if (!isOneOf(STRENGTHS, item.strength)) throw new EvidenceError('strength');
  if (UNPROVEN.includes(item.provenance) && !UNPROVEN_STRENGTHS.includes(item.strength))
    throw new EvidenceError('claim_strength');
  if (!item.limit.trim()) throw new EvidenceError('limit');
}
