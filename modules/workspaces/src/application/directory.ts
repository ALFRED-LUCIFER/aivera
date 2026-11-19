import type { WorkspaceSummary } from '../domain/workspace.ts';

export type DirectoryPorts = {
  /** Every workspace id, newest first. */
  listIds(): Promise<string[]>;
  /** The workspace's facts, read inside withWorkspace(<that workspace>); null when it no longer exists. */
  readSummary(workspaceId: string): Promise<WorkspaceSummary | null>;
};

export type DirectorySearch = { query: string; offset: number; limit: number };

/** The operator console's workspace reads (ADR-012 point 6): platform facts only, never through an RLS bypass. */
export function directoryUseCases({ listIds, readSummary }: DirectoryPorts) {
  const getSummary = readSummary;
  return {
    getSummary,
    async listSummaries({ query, offset, limit }: DirectorySearch) {
      // shortcut: one transaction per workspace, and the name match runs here, because names are read only inside each
      // workspace's own scope (ADR-012 point 6); fine up to a few hundred workspaces. Upgrade to the aivera_ops role with
      // column grants when the list is slow.
      const all = await Promise.all((await listIds()).map(getSummary));
      const needle = query.trim().toLocaleLowerCase('en');
      const matching = all.filter(
        (s): s is WorkspaceSummary => s !== null && s.name.toLocaleLowerCase('en').includes(needle),
      );
      return { total: matching.length, summaries: matching.slice(offset, offset + limit) };
    },
  };
}
