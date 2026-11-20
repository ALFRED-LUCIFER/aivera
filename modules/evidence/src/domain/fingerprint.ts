// MIT License. Copyright (c) 2026 Santiago Fernández de Valderrama. Ported to TypeScript and extended for Credalent
// (boilerplate skip, origin groups, combining marks kept); the licence text is in THIRD_PARTY_NOTICES.md.
//
// A text fingerprint tells when two evidence sources are near-copies (AIV-P1-071): a 64-bit SimHash over 3-word
// shingles of the normalised text, so near-identical texts land within a few bits of each other and only 16 hex
// characters are stored, never more text. A text with too little signal gets no fingerprint and never matches.
import { createHash } from 'node:crypto';

/** Normalised texts shorter than this carry too little signal to tell a real copy from shared boilerplate. */
export const FINGERPRINT_MIN_TEXT = 200;

/** At or above this, two sources are near-duplicates: at most 5 of the 64 bits differ (1 − 5/64 = 0.921875). */
export const NEAR_DUPLICATE_THRESHOLD = 0.92;

const FINGERPRINT = /^[0-9a-f]{16}$/;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
const PHONE = /\+?\d(?:[ ().-]?\d){7,}/g;
/** CV section headings: a line made only of these words is a heading, not evidence. */
const HEADINGS = new Set(
  'about achievements awards certifications contact courses education experience employment history hobbies interests languages objective personal profile projects publications references skills summary technical work and'.split(
    ' ',
  ),
);

/**
 * Lowercase, strip tags, entities and URLs, and collapse everything but letters, combining marks and digits to single
 * spaces (Unicode-aware, so Arabic words keep their marks and stay whole).
 */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
}

/**
 * A line is CV boilerplate when it has at most three words (a name, a heading, a place), only section headings, or a
 * list of short items ("Python, SQL, Docker").
 */
function isBoilerplateLine(line: string): boolean {
  const words = normalizeText(line).split(' ');
  if (words.length <= 3 || words.every((w) => HEADINGS.has(w))) return true;
  const parts = line.split(/[,;·|•]/);
  return parts.length > 1 && parts.every((p) => p.trim().split(/\s+/).length <= 3);
}

/** Drops contact details (emails, phone numbers), heading lines and short skills lists, keeping the prose. */
export function stripBoilerplate(text: string): string {
  return text
    .replace(EMAIL, ' ')
    .replace(PHONE, ' ')
    .split('\n')
    .filter((line) => !isBoilerplateLine(line))
    .join('\n');
}

/** The 16-hex-character SimHash of a text, or null when it carries too little signal to fingerprint. */
export function fingerprintText(text: string): string | null {
  const normalized = normalizeText(stripBoilerplate(text));
  if (normalized.length < FINGERPRINT_MIN_TEXT) return null;
  const tokens = normalized.split(' ');
  // One long unspaced token can pass the length check with no shingle: an all-zero hash would then match every
  // other such text, so it gets no fingerprint.
  if (tokens.length < 3) return null;
  const weights = Array.from({ length: 64 }, () => 0);
  for (let i = 0; i <= tokens.length - 3; i++) {
    // The first 8 bytes of the shingle's SHA-1 are its 64-bit hash: deterministic, no I/O.
    const digest = createHash('sha1')
      .update(`${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`)
      .digest();
    for (let bit = 0; bit < 64; bit++)
      weights[bit] = (weights[bit] ?? 0) + (((digest[bit >> 3] ?? 0) >> (7 - (bit & 7))) & 1 ? 1 : -1);
  }
  let hash = 0n;
  for (let bit = 0; bit < 64; bit++) if ((weights[bit] ?? 0) > 0) hash |= 1n << BigInt(63 - bit);
  return hash.toString(16).padStart(16, '0');
}

/** 1 − hamming/64; an empty or malformed fingerprint never matches (0). */
export function similarity(a: string | null, b: string | null): number {
  if (!a || !b || !FINGERPRINT.test(a) || !FINGERPRINT.test(b)) return 0;
  const differing = (BigInt(`0x${a}`) ^ BigInt(`0x${b}`)).toString(2).replaceAll('0', '').length;
  return 1 - differing / 64;
}

export const isNearDuplicate = (a: string | null, b: string | null) => similarity(a, b) >= NEAR_DUPLICATE_THRESHOLD;

export type FingerprintedSource = { id: string; candidateId: string; textFingerprint: string | null };

/**
 * Sources grouped into origins, in first-seen order: one candidate's near-duplicate sources (directly or through
 * another) form one origin, so one write-up never counts as two independent origins (AIV-P1-029). Sources of different
 * candidates are never grouped; a source with no fingerprint is its own origin.
 */
export function groupOrigins(sources: readonly FingerprintedSource[]): string[][] {
  let groups: FingerprintedSource[][] = [];
  for (const s of sources) {
    const joins = (g: FingerprintedSource[]) =>
      g.some((o) => o.candidateId === s.candidateId && isNearDuplicate(o.textFingerprint, s.textFingerprint));
    groups = [...groups.filter((g) => !joins(g)), [...groups.filter(joins).flat(), s]];
  }
  return groups.map((g) => g.map((s) => s.id));
}

/** Other candidates' sources that are near-duplicates of `source`, with their similarity. */
export function crossApplicantMatches(source: FingerprintedSource, others: readonly FingerprintedSource[]) {
  return others
    .filter((o) => o.candidateId !== source.candidateId)
    .map((o) => ({ ...o, similarity: similarity(source.textFingerprint, o.textFingerprint) }))
    .filter((o) => o.similarity >= NEAR_DUPLICATE_THRESHOLD);
}

/** Why a person closed an "Also submitted by another applicant" flag. Labels: `evidence.duplicate.resolution.*`. */
export const DUPLICATE_RESOLUTIONS = ['shared_group_project', 'same_template', 'needs_follow_up'] as const;
export type DuplicateResolution = (typeof DUPLICATE_RESOLUTIONS)[number];

/**
 * Two different candidates' sources in one workspace are near-duplicates. Neutral (shared group work is a legitimate
 * explanation): it never changes a score, rank, stage or contact (AGENTS.md 1.5); a person resolves it with a reason.
 */
export type DuplicateFlag = {
  id: string;
  workspaceId: string;
  sourceId: string;
  candidateId: string;
  otherSourceId: string;
  otherCandidateId: string;
  similarity: number;
  resolution: DuplicateResolution | null;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
};
