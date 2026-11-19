import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import {
  clientNames,
  filterByClient,
  filterCounts,
  filterJobs,
  parseFilter,
  type JobFilter,
  type JobRow,
} from '../domain/jobsList.ts';
import { replaceFilterInUrl } from '../services/filterUrl.ts';

/**
 * The Jobs list: the filter from the URL, the rows it shows, and each tab's count. An agency also filters by client
 * (AIV-P1-056); the tabs count within the chosen client.
 */
export function useJobsListController(rows: JobRow[], agency: boolean) {
  const filter = parseFilter(useSearchParams().get('filter'));
  // shortcut: the client choice lives in state, not the URL like the tabs; move it to the URL if recruiters ask to link it.
  const [client, setClient] = useState('');
  const scoped = filterByClient(rows, client);
  return {
    status: 'ready' as const,
    filter,
    counts: filterCounts(scoped),
    total: rows.length,
    rows: filterJobs(scoped, filter),
    onFilterChange: (next: JobFilter) => replaceFilterInUrl(next),
    clients: agency ? clientNames(rows) : null,
    client,
    onClientChange: setClient,
  };
}
