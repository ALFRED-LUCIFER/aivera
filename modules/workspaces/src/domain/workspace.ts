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

/**
 * A workspace's platform facts for the operator console (ADR-012 point 6): metadata and a count, never a member, a
 * client or anything about a candidate.
 */
export type WorkspaceSummary = {
  id: string;
  name: string;
  type: WorkspaceType;
  createdAt: Date;
  synthetic: boolean;
  /** Every workspace is active until suspension exists (AIV-P2-037). */
  status: 'active';
  /** Members whose status is active; invited and removed members are not counted. */
  activeMembers: number;
};

/**
 * Input plus output AI tokens a workspace may spend per UTC day (AIV-P0-033, AIV-P2-038): the platform default, and the
 * bounds of an operator's per-workspace override. Mirrored by `workspace_ai_daily_token_budget_check`.
 */
export const AI_DAILY_TOKEN_BUDGET = { default: 2_000_000, min: 100_000, max: 10_000_000 } as const;

/** One workspace's AI token use for the operator console: its daily budget and the tokens spent per UTC day. */
export type AiTokenUse = {
  /** The budget in force: the operator's override, or the platform default. */
  dailyBudget: number;
  /** True when an operator set `dailyBudget`; false for the platform default. */
  overridden: boolean;
  /** Tokens per UTC day (`YYYY-MM-DD`), newest (today) first, one entry per day of the window, 0 when no call. */
  days: { day: string; tokens: number }[];
};

const DAY_MS = 86_400_000;

/** The `count` UTC days ending on `today` (`YYYY-MM-DD`), newest first, with 0 tokens for a day with no use. */
export function usageWindow(today: string, count: number, used: { day: string; tokens: number }[]) {
  const end = Date.parse(`${today}T00:00:00Z`);
  return Array.from({ length: count }, (_, i) => {
    const day = new Date(end - i * DAY_MS).toISOString().slice(0, 10);
    return { day, tokens: used.find((u) => u.day === day)?.tokens ?? 0 };
  });
}

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
  not_synthetic: 'Only a synthetic demo workspace can be seeded or purged.',
  no_workspace: 'No such workspace',
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
