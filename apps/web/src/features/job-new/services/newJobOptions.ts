import type { WorkspaceContext } from '@credalent/workspaces';
import { getIdentity } from '@/server/auth';
import { getWorkspaces } from '@/server/workspace';

type Option = { value: string; label: string };
type NewJobOptions = {
  /** Active members with role Hiring owner, by name. */
  hiringOwners: Option[];
  /** An agency's clients that are not archived; null for an in-house team, which names a team instead. */
  clients: Option[] | null;
  synthetic: boolean;
  /** The workspace's hiring focus, which preselects the job type when the catalogue offers it. */
  hiringFocus: string;
};

/**
 * What the add-job form may offer, for an admin or recruiter only (`job.create`; anyone else is refused with
 * `ForbiddenError`). The server action reads it again, so a posted hiring owner or client must be one of these.
 */
export async function newJobOptions(ctx: WorkspaceContext): Promise<NewJobOptions> {
  const workspaces = getWorkspaces();
  await workspaces.authorize(ctx, 'job.create');
  const workspace = await workspaces.getWorkspace(ctx);
  if (!workspace) throw new Error('active workspace not found');
  const owners = (await workspaces.listMembers(ctx)).filter((m) => m.role === 'hiring_owner' && m.status === 'active');
  // shortcut: one identity read per hiring owner; a batch read in identity when a workspace has more than a handful.
  const hiringOwners = (
    await Promise.all(
      owners.map(async ({ userId }) => {
        const user = await getIdentity().getUser(userId, ctx);
        return user && { value: userId, label: user.displayName ?? user.email };
      }),
    )
  ).filter((o) => o !== null);
  const clients =
    workspace.type === 'agency'
      ? (await workspaces.listClients(ctx)).filter((c) => !c.archivedAt).map((c) => ({ value: c.id, label: c.name }))
      : null;
  return {
    hiringOwners: hiringOwners.toSorted((a, b) => a.label.localeCompare(b.label)),
    clients,
    synthetic: workspace.synthetic,
    hiringFocus: workspace.hiringFocus,
  };
}
