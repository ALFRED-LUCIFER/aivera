// A workspace is a tenant: one hiring team. Members belong to it with a role (ADR-005).

export const ROLES = ['admin', 'recruiter', 'hiring_owner', 'interviewer'] as const;
export type Role = (typeof ROLES)[number];

export const MEMBER_STATUSES = ['invited', 'active', 'removed'] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

export type Workspace = {
  id: string;
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

const MESSAGES = {
  forbidden: 'Only a workspace admin can change roles',
  not_found: 'No such member in this workspace',
  last_admin: 'A workspace needs at least one admin',
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
