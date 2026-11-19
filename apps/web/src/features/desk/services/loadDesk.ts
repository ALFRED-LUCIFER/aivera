import { getIdentity } from '@/server/auth';
import { getJobs } from '@/server/jobs';
import { getWorkspaces, inActiveWorkspace } from '@/server/workspace';
import { approvalItems, type ApprovalItem } from '../domain/desk.ts';

/**
 * My desk's rubric approvals (AIV-P1-014) through `listRubricApprovals`, which checks `job.list` and the member's job
 * scope, with each hiring owner named by their title in the workspace, else their name. Null when there is no workspace.
 */
export async function loadDesk(): Promise<ApprovalItem[] | null> {
  const result = await inActiveWorkspace(async (ctx) => ({
    rows: await getJobs().listRubricApprovals(ctx),
    workspaceId: ctx.workspaceId,
  }));
  if (!result) return null;
  const { rows, workspaceId } = result.value;
  const ownerIds = [...new Set(rows.flatMap((r) => r.hiringOwnerUserId ?? []))];
  const owners = new Map(
    await Promise.all(
      ownerIds.map(async (id) => {
        const title = (await getWorkspaces().getMembership(id, workspaceId))?.title;
        const user = title ? null : await getIdentity().getUser(id);
        return [id, title || user?.displayName || user?.email || ''] as const;
      }),
    ),
  );
  return approvalItems(rows, owners);
}
