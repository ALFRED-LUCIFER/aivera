// A job and its own versioned rubric (AIV-P1-005). Assessment reads only the approved version; editing an approved
// rubric starts a new version, and the approved one stays in force until the new one is approved.
import { isRegionalHint, nameKey, type CatalogueVersion } from './catalogue.ts';

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
  /** A job type key of the catalogue (ADR-013); a retired one stays valid on the job. */
  jobType: string;
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
  packKey?: string | null;
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
  /** Who last sent it for approval (AIV-P1-014); the approval or return is reported to them. */
  submittedBy: string | null;
  /** The hiring owner's note when they returned it; cleared when it is sent again. */
  returnNote: string | null;
  /** Bumped on every save of a version not yet approved; a save from an older copy is refused (AIV-P1-013). */
  revision: number;
};

/** A version with its competencies in position order. */
export type Rubric = RubricVersion & { competencies: Competency[] };

const MESSAGES = {
  title: 'Enter the job title.',
  job_type: 'Unknown job type.',
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
  stale: 'This rubric changed since you opened it. Reload to see the latest.',
  return_note: 'Write a note of up to 1,000 characters saying what to change.',
  rubric_not_approved: 'Publish after the rubric is approved.',
  stage_needs_rubric: 'Approve the rubric before moving the job on.',
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
 * version exactly on `domain_pack` competencies, and a regional hint only ever desirable (AGENTS.md 1.5). A pack is one
 * the published catalogue offers, at a version no newer than the published one; a retired pack only on a competency
 * `kept` (the rubric's latest stored version) already holds with it (ADR-013 point 7).
 */
export function assertValidCompetencies(
  competencies: Competency[],
  catalogue: CatalogueVersion,
  kept: readonly Competency[] = [],
): void {
  if (competencies.length === 0) throw new JobError('no_competencies');
  for (const c of competencies) {
    if (!c.name.trim()) throw new JobError('competency_name');
    if (!Number.isInteger(c.weightPercent) || c.weightPercent < 1 || c.weightPercent > 100)
      throw new JobError('weight');
    if (!Number.isInteger(c.levelNeeded) || c.levelNeeded < 1 || c.levelNeeded > 5) throw new JobError('level');
    const packed = Boolean(
      c.packKey &&
      c.packVersion &&
      c.packVersion <= catalogue.version &&
      catalogue.packs.some(
        (p) => p.key === c.packKey && (!p.retired || kept.some((k) => k.packKey === c.packKey && k.name === c.name)),
      ),
    );
    if ((c.origin === 'domain_pack') !== packed) throw new JobError('domain_pack');
    // Knowing a market's rules is evidence of a skill, never a residency requirement, so it can never be mandatory.
    if (c.type !== 'desirable' && isRegionalHint(catalogue, c.name)) throw new JobError('regional_desirable');
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

/**
 * The change note for a new version (AIV-P1-013), from the approved competencies to the edited ones, matched by name:
 * "Cost and reliability raised from 15% to 20%; Product judgement lowered from 15% to 10%." Null when nothing changed.
 * shortcut: written in English and stored; store the change list and word it per locale when Arabic ships (AIV-P5-007).
 */
export function describeChanges(before: readonly Competency[], after: readonly Competency[]): string | null {
  const old = new Map(before.map((c) => [nameKey(c.name), c]));
  const changes = after.flatMap((c) => {
    const was = old.get(nameKey(c.name));
    if (!was) return [`${c.name} added`];
    return [
      was.weightPercent !== c.weightPercent &&
        `${c.name} ${c.weightPercent > was.weightPercent ? 'raised' : 'lowered'} from ${was.weightPercent}% to ${c.weightPercent}%`,
      was.levelNeeded !== c.levelNeeded &&
        `${c.name} level changed from ${was.levelNeeded} of 5 to ${c.levelNeeded} of 5`,
      was.type !== c.type && `${c.name} changed to ${c.type}`,
    ].filter((change) => change !== false);
  });
  const kept = new Set(after.map((c) => nameKey(c.name)));
  const removed = before.filter((c) => !kept.has(nameKey(c.name))).map((c) => `${c.name} removed`);
  const all = [...changes, ...removed];
  return all.length > 0 ? `${all.join('; ')}.` : null;
}

const TRANSITIONS: Partial<Record<RubricStatus, RubricStatus[]>> = {
  // A recruiter approves a draft or returned version directly (ADR-014); sending it to the hiring owner is optional.
  draft: ['awaiting_approval', 'approved'],
  returned: ['awaiting_approval', 'approved'],
  awaiting_approval: ['approved', 'returned'],
  approved: ['superseded'],
};

export function assertTransition(from: RubricStatus, to: RubricStatus): void {
  if (!TRANSITIONS[from]?.includes(to)) throw new JobError('version_status');
}

/** The longest note a hiring owner returns a version with; rubric_version_return_note_check repeats it. */
export const RETURN_NOTE_MAX = 1000;

/** Throws unless the note is 1 to 1,000 characters after trimming; returns it trimmed. */
export function validReturnNote(value: string): string {
  const note = value.trim();
  if (!note || note.length > RETURN_NOTE_MAX) throw new JobError('return_note');
  return note;
}

/**
 * Who may approve or return a job's rubric (AIV-P1-014, ADR-014): the job's own hiring owner ('owner'), or an admin or
 * recruiter, who owns the job's rubric ('recruiter'). A hiring owner granted the job through its client, but not its
 * owner, may not. The role and job grant are checked by `rubric.approve` first; this narrows hiring owners to the one
 * named on the job. Audit entries from before ADR-014 may say 'admin_as_owner'.
 */
export const approvesAs = (
  role: string,
  userId: string,
  job: Pick<Job, 'hiringOwnerUserId'>,
): 'owner' | 'recruiter' | null =>
  job.hiringOwnerUserId === userId && (role === 'admin' || role === 'hiring_owner')
    ? 'owner'
    : role === 'admin' || role === 'recruiter'
      ? 'recruiter'
      : null;

/** The longest public descriptor ("A BNPL fintech", "A retail bank"); job_publication_check repeats it. */
export const PUBLIC_DESCRIPTOR_MAX = 80;

/**
 * What the candidate site shows of a job (AIV-P1-015). Built field by field from an allow-list: no weight, no client
 * name or id, no candidate, no score and no workspace id. The job description is left out: it is free text that can
 * name the client, and the publish preview does not list it as shown.
 */
export type PublicListing = {
  title: string;
  jobType: string;
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

/**
 * A rubric approval on the recruiter's desk (AIV-P1-014): waiting while the version awaits its hiring owner, done once
 * approved.
 */
export type RubricApproval = {
  jobId: string;
  title: string;
  hiringOwnerUserId: string | null;
  versionId: string;
  version: number;
  status: Extract<RubricStatus, 'awaiting_approval' | 'approved'>;
  approvedAt: Date | null;
};

/**
 * A rubric waiting for its recruiter's approval on My desk (AIV-P1-084, ADR-014): the job's open draft or returned
 * version, which an admin or recruiter approves directly.
 */
export type RubricToApprove = {
  jobId: string;
  title: string;
  version: number;
  status: Extract<RubricStatus, 'draft' | 'returned'>;
};

/** A job's rubric as the Jobs list shows it: whether a version is in force, and the latest version's status. */
export type RubricState = { approved: boolean; latest: RubricStatus | null };

/** What the job needs next (AIV-P1-006). */
export type NextAction =
  | { kind: 'approve_rubric' | 'rubric_approval_pending' | 'decide_shortlist' }
  | { kind: 'chase_evidence'; count: number };

/** Progress other modules report; null means not yet available, never a guessed "nothing to do" (AGENTS.md 1.7). */
export type JobProgress = { packReady: boolean | null; openEvidenceRequests: number | null };

/** The rubric comes first: nothing is assessed before it is approved (ADR-014). Null when nothing is known to do. */
export function nextAction(rubric: RubricState, progress: JobProgress): NextAction | null {
  if (rubric.latest === null || rubric.latest === 'draft' || rubric.latest === 'returned')
    return { kind: 'approve_rubric' };
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

/**
 * What every job page's header shows (AIV-P1-011): the job, its approved version and its latest version (the same one
 * when nothing newer is open), and how many candidates are assessed. `assessed` follows `DeskJob.assessed`.
 */
export type JobHeader = {
  job: Job;
  approved: RubricVersion | null;
  latest: RubricVersion | null;
  assessed: number | null;
  /** The candidate site's slug while the job is published (AIV-P1-015, "View public listing"); null otherwise. */
  publicSlug: string | null;
};
