import { invitationState, type WorkspaceContext } from '@aivera/workspaces';
import { getIdentity } from '@/server/auth';
import { getJobs } from '@/server/jobs';
import { getWorkspaces } from '@/server/workspace';
import type { MemberRow, Option } from '../domain/members.ts';

export type MembersData = {
  rows: MemberRow[];
  /** Every job of the workspace, for the job picker. */
  jobs: Option[];
  /** An agency's clients that are not archived; null for an in-house team. */
  clients: Option[] | null;
};

/**
 * The members screen, for admins only (`member.invite`; anyone else gets `ForbiddenError`, the 403 page): active members
 * with their job access, then invitations neither accepted nor revoked.
 */
export async function loadMembers(ctx: WorkspaceContext): Promise<MembersData> {
  const workspaces = getWorkspaces();
  await workspaces.authorize(ctx, 'member.invite');
  const workspace = await workspaces.getWorkspace(ctx);
  if (!workspace) throw new Error('active workspace not found');
  const jobs = await getJobs().listJobs(ctx);
  const allClients = workspace.type === 'agency' ? await workspaces.listClients(ctx) : [];
  const names = new Map<string, string>([
    ...jobs.map((j) => [j.id, j.title] as const),
    ...allClients.map((c) => [c.id, c.name] as const),
  ]);
  const access = (jobIds: string[], clientIds: string[]) =>
    [...jobIds, ...clientIds].map((id) => names.get(id)).filter((n) => n !== undefined);
  const grants = await workspaces.listJobGrants(ctx);
  const members = (await workspaces.listMembers(ctx.workspaceId)).filter((m) => m.status === 'active');
  // shortcut: one identity read per member, as newJobOptions does; a batch read in identity once workspaces grow.
  const memberRows = await Promise.all(
    members.map(async (m): Promise<MemberRow> => {
      const user = await getIdentity().getUser(m.userId);
      const own = grants.filter((g) => g.userId === m.userId);
      const jobIds = own.flatMap((g) => (g.jobId ? [g.jobId] : []));
      const clientIds = own.flatMap((g) => (g.clientId ? [g.clientId] : []));
      return {
        id: m.userId,
        kind: 'member',
        name: user?.displayName ?? null,
        email: user?.email ?? '',
        role: m.role,
        title: m.title,
        jobIds,
        clientIds,
        access: access(jobIds, clientIds),
        status: 'active',
        self: m.userId === ctx.userId,
      };
    }),
  );
  const now = new Date();
  const invitationRows = (await workspaces.listInvitations(ctx)).map((i): MemberRow => ({
    id: i.id,
    kind: 'invitation',
    name: null,
    email: i.email,
    role: i.role,
    title: i.title,
    jobIds: i.jobIds,
    clientIds: i.clientIds,
    access: access(i.jobIds, i.clientIds),
    status: invitationState(i, now) === 'expired' ? 'expired' : 'invited',
    self: false,
  }));
  return {
    rows: [...memberRows, ...invitationRows],
    jobs: jobs.map((j) => ({ value: j.id, label: j.title })),
    clients:
      workspace.type === 'agency'
        ? allClients.filter((c) => !c.archivedAt).map((c) => ({ value: c.id, label: c.name }))
        : null,
  };
}
