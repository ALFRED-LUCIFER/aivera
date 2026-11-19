import { JOB_SCOPED_ROLES } from './permissions.ts';
import { WorkspaceError, type Role } from './workspace.ts';

// An invitation to join a workspace with a role (AIV-P1-003, ADR-009). Hiring owners and interviewers are invited to
// named jobs or to all of a client's jobs; admins and recruiters get the whole workspace.

export type Invitation = {
  id: string;
  email: string;
  role: Role;
  /** The job title shown in the app, such as "CPO, Payments"; null when none was given. */
  title: string | null;
  jobIds: string[];
  clientIds: string[];
  invitedBy: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
};

export type InvitationState = 'open' | 'expired' | 'revoked' | 'accepted';

export const invitationState = (invitation: Invitation, now: Date): InvitationState => {
  if (invitation.acceptedAt) return 'accepted';
  if (invitation.revokedAt) return 'revoked';
  return invitation.expiresAt <= now ? 'expired' : 'open';
};

/** `days` is the workspace's `invitationDays` setting (AIV-P1-051, default 7) in force when the invitation is sent. */
export const invitationExpiry = (now: Date, days: number) => new Date(now.getTime() + days * 86_400_000);

/**
 * Hiring owners and interviewers need at least one job or client; admins and recruiters see every job, so they get
 * none. Mirrored by `invitation_access_check`.
 */
export function assertAccessFitsRole(role: Role, access: { jobIds: string[]; clientIds: string[] }): void {
  const named = access.jobIds.length + access.clientIds.length > 0;
  if (JOB_SCOPED_ROLES.includes(role) && !named) throw new WorkspaceError('jobs_required');
  if (!JOB_SCOPED_ROLES.includes(role) && named) throw new WorkspaceError('jobs_not_allowed');
}
