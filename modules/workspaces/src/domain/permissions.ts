import type { JobGrant, Role, WorkspaceStatus } from './workspace.ts';

// Which roles may take each action (AIV-P0-010). A job-scoped action also needs, for a hiring owner or interviewer, a
// job grant covering the record's job (ADR-005 point 6). Screen tickets add their actions here. `reads: true` marks an
// action that changes nothing, so it stays open while the workspace is not active; every other action is refused then.
export const PERMISSIONS = {
  'job.create': { scope: 'workspace', roles: ['admin', 'recruiter'] },
  // Listing is workspace-wide; the jobs repository and row-level security narrow it to granted jobs (AIV-P1-005).
  'job.list': { reads: true, scope: 'workspace', roles: ['admin', 'recruiter', 'hiring_owner', 'interviewer'] },
  'job.view': { reads: true, scope: 'job', roles: ['admin', 'recruiter', 'hiring_owner', 'interviewer'] },
  'rubric.edit': { scope: 'job', roles: ['admin', 'recruiter'] },
  // Publishing lists the job on the candidate site (AIV-P1-015).
  'job.publish': { scope: 'job', roles: ['admin', 'recruiter'] },
  'workspace.settings': { scope: 'workspace', roles: ['admin'] },
  'client.manage': { scope: 'workspace', roles: ['admin', 'recruiter'] },
  'job_access.manage': { scope: 'workspace', roles: ['admin'] },
  'job_access.view': { reads: true, scope: 'workspace', roles: ['admin', 'recruiter'] },
  'member.invite': { scope: 'workspace', roles: ['admin'] },
  'rubric.approve': { scope: 'job', roles: ['admin', 'hiring_owner'] },
  'candidate.create': { scope: 'workspace', roles: ['admin', 'recruiter'] },
  'candidate.view': { reads: true, scope: 'job', roles: ['admin', 'recruiter', 'hiring_owner', 'interviewer'] },
  'scorecard.submit': { scope: 'job', roles: ['admin', 'recruiter', 'hiring_owner', 'interviewer'] },
  'decision.record': { scope: 'job', roles: ['admin', 'recruiter', 'hiring_owner'] },
} as const satisfies Record<string, { scope: 'workspace' | 'job'; roles: readonly Role[]; reads?: true }>;

export type Action = keyof typeof PERMISSIONS;

/** The record's job, and the job's agency client if it has one. */
export type JobResource = { jobId: string; clientId?: string | null };

/** Roles that see only the jobs they are granted; admins and recruiters see the whole workspace. */
export const JOB_SCOPED_ROLES: readonly Role[] = ['hiring_owner', 'interviewer'];

/** A grant covers the resource when it names that job, or the job's client (so also the client's future jobs). */
export const grantsCover = (grants: Pick<JobGrant, 'jobId' | 'clientId'>[], { jobId, clientId }: JobResource) =>
  grants.some((g) => g.jobId === jobId || (!!clientId && g.clientId === clientId));

/** A refused request: not a member of the workspace, or the role or job grant does not allow the action. HTTP 403. */
export class ForbiddenError extends Error {
  constructor() {
    super('Forbidden');
    this.name = 'ForbiddenError';
  }
}

/**
 * Refused because the workspace is not active (suspended by an operator, AIV-P2-037): reads stay open, new work does
 * not. A `ForbiddenError`, so every caller that maps a refusal to HTTP 403 maps this one too.
 */
export class WorkspacePausedError extends ForbiddenError {
  readonly status: WorkspaceStatus;
  constructor(status: WorkspaceStatus) {
    super();
    this.name = 'WorkspacePausedError';
    this.status = status;
  }
}

/** Whether `action` may run in a workspace with `status`: anything in an active one, only reads otherwise. */
export const allowedWhile = (status: WorkspaceStatus, action: Action) =>
  status === 'active' || 'reads' in PERMISSIONS[action];
