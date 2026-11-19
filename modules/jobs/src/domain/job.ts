// A job and its own versioned rubric (AIV-P1-005). Assessment reads only the approved version; editing an approved
// rubric starts a new version, and the approved one stays in force until the new one is approved.
import { DOMAIN_KEYS, isRegionalHint, nameKey, type DomainKey } from './domain-packs.ts';
import type { JobType } from './job-types.ts';

/** Must list exactly the `job_stage_check` values (infrastructure/schema.ts); changing it needs a new migration. */
export const JOB_STAGES = ['defining_rubric', 'collecting_evidence', 'round_1', 'decision', 'closed'] as const;
export type JobStage = (typeof JOB_STAGES)[number];

/** Must list exactly the `rubric_version_status_check` values (infrastructure/schema.ts). */
export const RUBRIC_STATUSES = ['draft', 'awaiting_approval', 'approved', 'superseded', 'returned'] as const;
export type RubricStatus = (typeof RUBRIC_STATUSES)[number];

export const COMPETENCY_TYPES = ['mandatory', 'desirable'] as const;
/** Must list exactly the `competency_origin_check` values (infrastructure/schema.ts); a new one needs a migration. */
export const COMPETENCY_ORIGINS = [
  'from_description',
  'suggested_by_aivera',
  'added_by_recruiter',
  'domain_pack',
] as const;

/** Integer minor units and an ISO currency (AGENTS.md 3.8). Stored as int4, so at most 2,147,483,647. */
export type PayBand = { minMinor: number; maxMinor: number; currency: string };

export type Job = {
  id: string;
  workspaceId: string;
  title: string;
  jobType: JobType;
  description: string;
  team: string | null;
  /** Opaque id of a `workspaces.client`; null is the team's own job (ADR-009). */
  clientId: string | null;
  location: string | null;
  /** Opaque user id of the workspace member who owns the hiring decision. */
  hiringOwnerUserId: string | null;
  stage: JobStage;
  published: boolean;
  /** How the candidate site names the employer, e.g. "A BNPL fintech"; never the client's name. Set on publishing. */
  publicDescriptor: string | null;
  /** When the job was last published; null until it first is. */
  publishedAt: Date | null;
  payBand: PayBand | null;
  /** Demo and test jobs (AGENTS.md 1.1). */
  synthetic: boolean;
  createdBy: string;
  createdAt: Date;
};

export type Competency = {
  name: string;
  evidenceExpected: string;
  weightPercent: number;
  levelNeeded: number;
  type: (typeof COMPETENCY_TYPES)[number];
  origin: (typeof COMPETENCY_ORIGINS)[number];
  /** The domain pack (AIV-P1-064) and catalogue version that seeded it: set exactly when `origin` is `domain_pack`. */
  packKey?: DomainKey | null;
  packVersion?: number | null;
};

export type RubricVersion = {
  id: string;
  workspaceId: string;
  jobId: string;
  version: number;
  status: RubricStatus;
  successStatement: string;
  changeNote: string | null;
  createdBy: string;
  createdAt: Date;
  approvedBy: string | null;
  approvedAt: Date | null;
};

/** A version with its competencies in position order. */
export type Rubric = RubricVersion & { competencies: Competency[] };

const MESSAGES = {
  title: 'Enter the job title.',
  pay_band: 'The pay band needs a minimum no higher than its maximum and a three-letter currency.',
  client_not_found: 'That client is not in this workspace.',
  no_competencies: 'A rubric needs at least one competency.',
  competency_name: 'Every competency needs a name.',
  weight: 'Each weight is a whole percentage from 1 to 100.',
  weights_total: 'Weights must total 100%.',
  level: 'The level needed is a whole number from 1 to 5.',
  domain_pack: 'A competency from a domain pack names its pack and version, and no other competency does.',
  regional_desirable: 'Regional knowledge is shown through evidence, so it can only be desirable.',
  not_found: 'That job or rubric version was not found.',
  version_status: 'This rubric version cannot move to that status.',
  rubric_not_approved: 'Publish after the rubric is approved.',
  not_synthetic: 'Only a synthetic workspace holding only synthetic jobs can be purged.',
  public_descriptor: 'Describe the employer for candidates, without its name, in up to 80 characters.',
} as const;

export type JobErrorCode = keyof typeof MESSAGES;

/** A refused jobs operation. */
export class JobError extends Error {
  readonly code: JobErrorCode;
  constructor(code: JobErrorCode) {
    super(MESSAGES[code]);
    this.name = 'JobError';
    this.code = code;
  }
}

/**
 * Throws unless the competencies form a valid rubric: named, weights 1–100 totalling 100, levels 1–5, a pack and its
 * version exactly on `domain_pack` competencies, and a regional hint only ever desirable (AGENTS.md 1.5).
 */
export function assertValidCompetencies(competencies: Competency[]): void {
  if (competencies.length === 0) throw new JobError('no_competencies');
  for (const c of competencies) {
    if (!c.name.trim()) throw new JobError('competency_name');
    if (!Number.isInteger(c.weightPercent) || c.weightPercent < 1 || c.weightPercent > 100)
      throw new JobError('weight');
    if (!Number.isInteger(c.levelNeeded) || c.levelNeeded < 1 || c.levelNeeded > 5) throw new JobError('level');
    const packed = Boolean(c.packKey && c.packVersion && DOMAIN_KEYS.includes(c.packKey));
    if ((c.origin === 'domain_pack') !== packed) throw new JobError('domain_pack');
    // Knowing a market's rules is evidence of a skill, never a residency requirement, so it can never be mandatory.
    if (c.type !== 'desirable' && isRegionalHint(c.name)) throw new JobError('regional_desirable');
  }
  if (competencies.reduce((sum, c) => sum + c.weightPercent, 0) !== 100) throw new JobError('weights_total');
}

/**
 * Weights scaled proportionally to total 100 (AIV-P1-010): each rounded down to a whole percent and at least 1, and the
 * rounding remainder given to the heaviest competency. Rounded down, so the heaviest only gains and stays the heaviest.
 * Weights that already total 100 are kept as they are.
 */
export function rebalanceWeights(competencies: Competency[]): Competency[] {
  const total = competencies.reduce((sum, c) => sum + c.weightPercent, 0);
  if (total === 100) return competencies;
  const scaled = competencies.map((c) => ({
    ...c,
    weightPercent: Math.max(1, Math.floor((c.weightPercent * 100) / total)),
  }));
  const weights = competencies.map((c) => c.weightPercent);
  const heaviest = weights.indexOf(Math.max(...weights));
  const remainder = 100 - scaled.reduce((sum, c) => sum + c.weightPercent, 0);
  return scaled.map((c, i) => (i === heaviest ? { ...c, weightPercent: c.weightPercent + remainder } : c));
}

/**
 * The suggestions that repeat no drafted competency and no earlier suggestion, comparing names without case or extra
 * spaces (AIV-P1-009). The prompt asks for this too; code makes sure.
 */
export function newSuggestions<T extends { name: string }>(
  drafted: readonly { name: string }[],
  suggestions: T[],
): T[] {
  const seen = new Set(drafted.map((c) => nameKey(c.name)));
  // `seen.add` returns the set (truthy), so a kept name also blocks a later suggestion with the same name.
  return suggestions.filter((s) => !seen.has(nameKey(s.name)) && seen.add(nameKey(s.name)));
}

const INT4_MAX = 2_147_483_647;

export function assertValidPayBand(band: PayBand | null): void {
  if (!band) return;
  const { minMinor, maxMinor, currency } = band;
  if (!Number.isInteger(minMinor) || !Number.isInteger(maxMinor) || minMinor < 0 || minMinor > maxMinor)
    throw new JobError('pay_band');
  if (maxMinor > INT4_MAX) throw new JobError('pay_band');
  if (!/^[A-Z]{3}$/.test(currency)) throw new JobError('pay_band');
}

/** A version not yet approved is edited in place; once approved (or with none yet), an edit starts the next version. */
export const editsInPlace = (latest: Pick<RubricVersion, 'status'> | null) =>
  latest?.status === 'draft' || latest?.status === 'returned' || latest?.status === 'awaiting_approval';

// shortcut: only submit and approve; returning a version and its notifications come with AIV-P1-014.
const TRANSITIONS: Partial<Record<RubricStatus, RubricStatus[]>> = {
  draft: ['awaiting_approval'],
  returned: ['awaiting_approval'],
  awaiting_approval: ['approved'],
  approved: ['superseded'],
};

export function assertTransition(from: RubricStatus, to: RubricStatus): void {
  if (!TRANSITIONS[from]?.includes(to)) throw new JobError('version_status');
}

/** The longest public descriptor ("A BNPL fintech", "A retail bank"); job_publication_check repeats it. */
export const PUBLIC_DESCRIPTOR_MAX = 80;

/**
 * What the candidate site shows of a job (AIV-P1-015). Built field by field from an allow-list: no weight, no client
 * name or id, no candidate, no score and no workspace id. The job description is left out: it is free text that can
 * name the client, and the publish preview does not list it as shown.
 */
export type PublicListing = {
  title: string;
  jobType: JobType;
  descriptor: string | null;
  location: string | null;
  // shortcut: a pay band has no period; the candidate site reads it as monthly (UAE norm), until a job states one.
  payBand: PayBand | null;
  competencies: { name: string; evidenceExpected: string; levelNeeded: number }[];
};

export const toPublicListing = (job: Job, competencies: readonly Competency[]): PublicListing => ({
  title: job.title,
  jobType: job.jobType,
  descriptor: job.publicDescriptor,
  location: job.location,
  payBand: job.payBand && {
    minMinor: job.payBand.minMinor,
    maxMinor: job.payBand.maxMinor,
    currency: job.payBand.currency,
  },
  competencies: competencies.map(({ name, evidenceExpected, levelNeeded }) => ({
    name,
    evidenceExpected,
    levelNeeded,
  })),
});

/** Throws unless the descriptor is 1 to 80 characters after trimming; returns it trimmed. */
export function validPublicDescriptor(value: string): string {
  const descriptor = value.trim();
  if (!descriptor || descriptor.length > PUBLIC_DESCRIPTOR_MAX) throw new JobError('public_descriptor');
  return descriptor;
}

/** A job's rubric as the Jobs list shows it: whether a version is in force, and the latest version's status. */
export type RubricState = { approved: boolean; latest: RubricStatus | null };

/** What the job needs next (AIV-P1-006). */
export type NextAction =
  { kind: 'send_rubric' | 'rubric_approval_pending' | 'decide_shortlist' } | { kind: 'chase_evidence'; count: number };

/** Progress other modules report; null means not yet available, never a guessed "nothing to do" (AGENTS.md 1.7). */
export type JobProgress = { packReady: boolean | null; openEvidenceRequests: number | null };

/** The rubric comes first: nothing is assessed before the hiring owner approves it. Null when nothing is known to do. */
export function nextAction(rubric: RubricState, progress: JobProgress): NextAction | null {
  if (rubric.latest === null || rubric.latest === 'draft' || rubric.latest === 'returned')
    return { kind: 'send_rubric' };
  if (rubric.latest === 'awaiting_approval') return { kind: 'rubric_approval_pending' };
  if (progress.packReady) return { kind: 'decide_shortlist' };
  if (progress.openEvidenceRequests) return { kind: 'chase_evidence', count: progress.openEvidenceRequests };
  return null;
}

/** A row of the recruiter's Jobs list. */
export type DeskJob = Job & {
  rubric: RubricState;
  /** Null is not yet available. Zero, observed by rule, while no rubric is approved: assessment reads only that. */
  assessed: number | null;
  /** Evidence coverage in whole percent; null is not yet available. */
  coveragePercent: number | null;
  nextAction: NextAction | null;
};
