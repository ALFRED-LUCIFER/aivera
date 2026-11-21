import { startTransition, useActionState, useState } from 'react';
import { pageCount, type WorkspacePage, type WorkspaceSearch, type WorkspacesListView } from '../domain/workspaces.ts';
import { searchWorkspaces } from '../services/searchWorkspaces.ts';

type State = { page: WorkspacePage; failed: WorkspaceSearch | null };

/**
 * The workspaces list: the search box, and the page the server returned for the last search (AIV-P2-036). Searching
 * and paging call the server action, so the search travels in the request body, never the URL.
 */
export function useWorkspacesController(initial: WorkspacePage): WorkspacesListView {
  const [query, setQuery] = useState(initial.search.query);
  const [state, load, pending] = useActionState(
    async (previous: State, search: WorkspaceSearch): Promise<State> => {
      try {
        return { page: await searchWorkspaces(search), failed: null };
      } catch {
        // The error itself stays on the server (it may name data); the list offers a retry of the same search.
        return { page: previous.page, failed: search };
      }
    },
    { page: initial, failed: null },
  );
  const run = (search: WorkspaceSearch) => startTransition(() => load(search));
  const { page, failed } = state;

  let table: WorkspacesListView['table'];
  if (pending) table = { status: 'loading' };
  else if (failed) table = { status: 'error', onRetry: () => run(failed) };
  else
    table = {
      status: 'ready',
      rows: page.rows,
      searched: page.search.query,
      filter: page.search,
      page: page.search.page,
      pageCount: pageCount(page.total),
      onPage: (next) => run({ ...page.search, page: next }),
    };

  return { search: { query, onQueryChange: setQuery, onSearch: () => run({ ...page.search, query, page: 1 }) }, table };
}
