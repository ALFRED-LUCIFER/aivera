import { ROLES, type Role } from '@credalent/workspaces';
import { z } from 'zod';

// Workspace members and invitations (AIV-P1-003). Pure: no React, no I/O (ADR-003).

/** Roles that work on named jobs only; the form shows the job picker for these. */
export const JOB_SCOPED: readonly Role[] = ['hiring_owner', 'interviewer'];

/** One row of the members list: an active member, or an invitation that is not accepted or revoked. */
export type MemberRow = {
  /** The member's user id, or the invitation id. */
  id: string;
  kind: 'member' | 'invitation';
  /** The member's display name; null for an invitation, or when the account has none. */
  name: string | null;
  email: string;
  role: Role;
  title: string | null;
  jobIds: string[];
  clientIds: string[];
  /** The job titles and client names the row reaches; empty for admins and recruiters, who see every job. */
  access: string[];
  status: 'active' | 'invited' | 'expired';
  /** The signed-in admin's own row. */
  self: boolean;
};

export type Option = { value: string; label: string };

/** The "Jobs" cell: "All jobs" for admins and recruiters, otherwise the job and client names. */
export const jobsCell = (row: Pick<MemberRow, 'role' | 'access'>, labels: { all: string; none: string }) =>
  JOB_SCOPED.includes(row.role) ? row.access.join(', ') || labels.none : labels.all;

// shortcut: the English possessive ("Dune Logistics' jobs", "Falcon Pay's jobs"); move it into the message per locale
// when Arabic ships (AIV-P5-007).
export const possessive = (name: string) => (name.endsWith('s') ? `${name}'` : `${name}'s`);

const ids = z.array(z.uuid()).max(200);
const formIds = (form: FormData, name: string) => form.getAll(name).map(String);

const inviteForm = z.object({
  email: z.email().max(254),
  role: z.enum(ROLES),
  title: z.string().trim().max(120),
  jobIds: ids,
  clientIds: ids,
});
export type InviteForm = z.infer<typeof inviteForm>;

export type InviteError = 'email' | 'jobsRequired' | 'failed';
/** What the invite form shows after a submit: the error and what was typed, or the address just invited. */
export type InviteState = {
  error: InviteError | null;
  invited: { email: string; expiresAt: string } | null;
  values: { email: string; title: string };
};
export const initialInviteState: InviteState = { error: null, invited: null, values: { email: '', title: '' } };

/**
 * The posted invite form, validated (AGENTS.md 3.7): the input, or the error to show. A job-scoped role with no job
 * or client is refused here and again by the module and the database.
 */
export function parseInviteForm(form: FormData): { input: InviteForm } | { error: InviteError } {
  const parsed = inviteForm.safeParse({
    email: String(form.get('email') ?? '').trim(),
    role: form.get('role'),
    title: form.get('title') ?? '',
    // The picker's choices only count for the roles that show it.
    jobIds: JOB_SCOPED.includes(form.get('role') as Role) ? formIds(form, 'jobIds') : [],
    clientIds: JOB_SCOPED.includes(form.get('role') as Role) ? formIds(form, 'clientIds') : [],
  });
  if (!parsed.success) return { error: parsed.error.issues.some((i) => i.path[0] === 'email') ? 'email' : 'failed' };
  const { role, jobIds, clientIds } = parsed.data;
  if (JOB_SCOPED.includes(role) && jobIds.length + clientIds.length === 0) return { error: 'jobsRequired' };
  return { input: parsed.data };
}

const manageForm = z.discriminatedUnion('intent', [
  z.object({ intent: z.literal('role'), userId: z.uuid(), role: z.enum(ROLES) }),
  z.object({ intent: z.literal('jobs'), userId: z.uuid(), jobIds: ids, clientIds: ids }),
  z.object({ intent: z.literal('remove'), userId: z.uuid() }),
  z.object({ intent: z.literal('revoke'), invitationId: z.uuid() }),
]);
export type ManageForm = z.infer<typeof manageForm>;

/** A change to one row: its role, its jobs, removing the member, or revoking the invitation; null when malformed. */
export const parseManageForm = (form: FormData): ManageForm | null =>
  manageForm.safeParse({
    intent: form.get('intent'),
    userId: form.get('userId') ?? undefined,
    invitationId: form.get('invitationId') ?? undefined,
    role: form.get('role') ?? undefined,
    jobIds: formIds(form, 'jobIds'),
    clientIds: formIds(form, 'clientIds'),
  }).data ?? null;

export type ManageError = 'lastAdmin' | 'failed';
/** The last change's result; `done` counts changes, so a dialog can close after its own one succeeds. */
export type ManageState = { error: ManageError | null; done: number };
export const initialManageState: ManageState = { error: null, done: 0 };

/** The one dialog the members list has open: edit a member's jobs, or confirm removing them. */
export type MemberDialog = { kind: 'jobs' | 'remove'; id: string };
