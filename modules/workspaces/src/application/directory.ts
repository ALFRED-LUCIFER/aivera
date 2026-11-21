import type { WorkspaceStatus, WorkspaceStatusFact, WorkspaceSummary } from '../domain/workspace.ts';

export type DirectoryPorts = {
  /** Every workspace id, newest first. */
  listIds(): Promise<string[]>;
  /** The workspace's facts, read inside withWorkspace(<that workspace>); null when it no longer exists. */
  readSummary(workspaceId: string): Promise<WorkspaceSummary | null>;
  /** The workspace's first admin (its creator), read inside withWorkspace(<that workspace>); null when there is none. */
  readCreator(workspaceId: string): Promise<string | null>;
  /** The workspace's status and created date only, read inside withWorkspace(<that workspace>); null when gone. */
  readStatus(workspaceId: string): Promise<WorkspaceStatusFact | null>;
};

/** A workspace waiting for approval (AIV-P2-039), with its creator's identity user id so the console can contact them. */
export type PendingApproval = { summary: WorkspaceSummary; creatorUserId: string | null };

/** `status`: only workspaces in that status (AIV-P2-051, the console home's links); absent: every status. */
export type DirectorySearch = { query: string; offset: number; limit: number; status?: WorkspaceStatus };

/** The operator console's workspace reads (ADR-012 point 6): platform facts only, never through an RLS bypass. */
export function directoryUseCases({ listIds, readSummary, readCreator, readStatus }: DirectoryPorts) {
  const getSummary = readSummary;
  return {
    getSummary,
    async listPending(): Promise<PendingApproval[]> {
      // shortcut: reads every workspace, as listSummaries does; fine up to a few hundred (ADR-012 point 6).
      const all = await Promise.all((await listIds()).map(getSummary));
      const pending = all
        .filter((s): s is WorkspaceSummary => s?.status === 'pending_approval')
        .toSorted((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      return Promise.all(pending.map(async (summary) => ({ summary, creatorUserId: await readCreator(summary.id) })));
    },
    async listStatuses(): Promise<WorkspaceStatusFact[]> {
      // shortcut: one transaction per workspace (ADR-012 point 6), as listSummaries; upgrade with aivera_ops.
      const all = await Promise.all((await listIds()).map(readStatus));
      return all.filter((s) => s !== null);
    },
    async listSummaries({ query, offset, limit, status }: DirectorySearch) {
      // shortcut: one transaction per workspace, and the name match runs here, because names are read only inside each
      // workspace's own scope (ADR-012 point 6); fine up to a few hundred workspaces. Upgrade to the aivera_ops role with
      // column grants when the list is slow.
      const all = await Promise.all((await listIds()).map(getSummary));
      const needle = query.trim().toLocaleLowerCase('en');
      const matching = all.filter(
        (s): s is WorkspaceSummary =>
          s !== null && s.name.toLocaleLowerCase('en').includes(needle) && (!status || s.status === status),
      );
      return { total: matching.length, summaries: matching.slice(offset, offset + limit) };
    },
  };
}
