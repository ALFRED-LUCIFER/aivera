// The operator console's workspaces list and detail (AIV-P2-036, ADR-012). Pure: no React, no I/O (ADR-003).
import type { WorkspaceSummary } from '@aivera/workspaces';
import { z } from 'zod';

const PAGE_SIZE = 50;

/** The list request, sent in the server action's body, never in the URL: the name search and the 1-based page. */
export const workspaceSearchSchema = z.object({
  query: z.string().trim().max(100),
  page: z.int().min(1).max(10_000),
});
export type WorkspaceSearch = z.infer<typeof workspaceSearchSchema>;

/** A workspace's platform facts and job count, as the list and detail show them. */
export type WorkspaceRow = WorkspaceSummary & { jobs: number };

/** One page of the list, with the search that produced it. */
export type WorkspacePage = { search: WorkspaceSearch; total: number; rows: WorkspaceRow[] };

/** The list's view model: the search box (absent on the first load) and the table's state. */
export type WorkspacesListView = {
  search?: { query: string; onQueryChange: (query: string) => void; onSearch: () => void };
  table:
    | { status: 'loading' }
    | { status: 'error'; onRetry: () => void }
    | {
        status: 'ready';
        rows: WorkspaceRow[];
        /** The search these rows answer, for the "No workspace matches" message. */
        searched: string;
        page: number;
        pageCount: number;
        onPage: (page: number) => void;
      };
};

export const toDirectorySearch = ({ query, page }: WorkspaceSearch) => ({
  query,
  offset: (page - 1) * PAGE_SIZE,
  limit: PAGE_SIZE,
});

export const pageCount = (total: number) => Math.max(1, Math.ceil(total / PAGE_SIZE));

export const workspaceHref = (id: string) => `/ops/workspaces/${id}` as const;
