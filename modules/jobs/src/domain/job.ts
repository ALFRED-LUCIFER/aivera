// A job and its own versioned rubric (AIV-P1-005). Assessment reads only the approved version; editing an approved
// rubric starts a new version, and the approved one stays in force until the new one is approved.
import type { JobType } from './job-types.ts';

/** Must list exactly the `job_stage_check` values (infrastructure/schema.ts); changing it needs a new migration. */
export const JOB_STAGES = ['defining_rubric', 'collecting_evidence', 'round_1', 'decision', 'closed'] as const;
export type JobStage = (typeof JOB_STAGES)[number];

/** Must list exactly the `rubric_version_status_check` values (infrastructure/schema.ts). */
export const RUBRIC_STATUSES = ['draft', 'awaiting_approval', 'approved', 'superseded', 'returned'] as const;
export type RubricStatus = (typeof RUBRIC_STATUSES)[number];

export const COMPETENCY_TYPES = ['mandatory', 'desirable'] as const;
export const COMPETENCY_ORIGINS = ['from_description', 'suggested_by_aivera'] as const;

/** Integer minor units and an ISO currency (AGENTS.md 3.8). */
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
  not_found: 'That job or rubric version was not found.',
  version_status: 'This rubric version cannot move to that status.',
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

/** Throws unless the competencies form a valid rubric: named, weights 1–100 totalling 100, levels 1–5. */
export function assertValidCompetencies(competencies: Competency[]): void {
  if (competencies.length === 0) throw new JobError('no_competencies');
  for (const c of competencies) {
    if (!c.name.trim()) throw new JobError('competency_name');
    if (!Number.isInteger(c.weightPercent) || c.weightPercent < 1 || c.weightPercent > 100)
      throw new JobError('weight');
    if (!Number.isInteger(c.levelNeeded) || c.levelNeeded < 1 || c.levelNeeded > 5) throw new JobError('level');
  }
  if (competencies.reduce((sum, c) => sum + c.weightPercent, 0) !== 100) throw new JobError('weights_total');
}

export function assertValidPayBand(band: PayBand | null): void {
  if (!band) return;
  const { minMinor, maxMinor, currency } = band;
  if (!Number.isSafeInteger(minMinor) || !Number.isSafeInteger(maxMinor) || minMinor < 0 || minMinor > maxMinor)
    throw new JobError('pay_band');
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
