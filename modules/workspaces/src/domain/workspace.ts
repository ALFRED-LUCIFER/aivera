// A workspace is a tenant: one hiring team. Members belong to it with a role (ADR-005).

export const ROLES = ['admin', 'recruiter', 'hiring_owner', 'interviewer'] as const;
export type Role = (typeof ROLES)[number];

export const MEMBER_STATUSES = ['invited', 'active', 'removed'] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

/** ADR-009: an in-house team hires for itself; an agency recruits for clients. */
export const WORKSPACE_TYPES = ['in_house', 'agency'] as const;
export type WorkspaceType = (typeof WORKSPACE_TYPES)[number];

export type Workspace = {
  id: string;
  type: WorkspaceType;
  name: string;
  company: string;
  hiringFocus: string;
  /** Demo and test workspaces hold only synthetic people (AGENTS.md 1.1). */
  synthetic: boolean;
  createdAt: Date;
};

export type Member = {
  userId: string;
  workspaceId: string;
  role: Role;
  status: MemberStatus;
};

/** An agency's client (ADR-005 point 6). Not a tenant: it only scopes jobs for hiring owners and interviewers. */
export type Client = { id: string; name: string; archivedAt: Date | null };

/** Access to one job, or to every current and future job of one client. Exactly one of the two is set. */
export type JobGrant = {
  id: string;
  userId: string;
  jobId: string | null;
  clientId: string | null;
  grantedBy: string;
  grantedAt: Date;
};

const MESSAGES = {
  forbidden: 'Only a workspace admin can change roles',
  not_found: 'No such member in this workspace',
  last_admin: 'A workspace needs at least one admin',
  not_agency: 'Only agency workspaces have clients.',
  has_clients: 'Archive every client before making this workspace an in-house team.',
  client_exists: 'A client with this name already exists.',
  client_name: "Enter the client's name.",
  client_not_found: 'No such client in this workspace',
  grant_role: 'Only hiring owners and interviewers get job access.',
} as const;

export type WorkspaceErrorCode = keyof typeof MESSAGES;

/** A refused workspace operation. `forbidden` maps to HTTP 403 at the edge (AIV-P0-010). */
export class WorkspaceError extends Error {
  readonly code: WorkspaceErrorCode;
  constructor(code: WorkspaceErrorCode) {
    super(MESSAGES[code]);
    this.name = 'WorkspaceError';
    this.code = code;
  }
}

/**
 * Throws unless `actorUserId` may give `targetUserId` the role `role`, given every member of the workspace:
 * only an active admin changes roles, and the last active admin cannot stop being one.
 */
export function assertCanChangeRole(members: Member[], actorUserId: string, targetUserId: string, role: Role): void {
  const active = members.filter((m) => m.status === 'active');
  if (active.find((m) => m.userId === actorUserId)?.role !== 'admin') throw new WorkspaceError('forbidden');
  const target = members.find((m) => m.userId === targetUserId && m.status !== 'removed');
  if (!target) throw new WorkspaceError('not_found');
  const admins = active.filter((m) => m.role === 'admin');
  if (role !== 'admin' && admins.length === 1 && admins[0]?.userId === targetUserId)
    throw new WorkspaceError('last_admin');
}
