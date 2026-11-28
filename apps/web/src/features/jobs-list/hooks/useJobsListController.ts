import { useSearchParams } from 'next/navigation';
import {
  filterByClient,
  filterCounts,
  filterJobs,
  parseClient,
  parseFilter,
  type ClientOption,
  type JobFilter,
  type JobRow,
} from '../domain/jobsList.ts';
import { replaceInUrl } from '../services/filterUrl.ts';

/**
 * The Jobs list: the filters from the URL, the rows they show, and each tab's count. An agency also filters by client
 * (AIV-P1-056), kept in the URL as the client's id so reload and Back keep it (AIV-P1-165); the tabs count within the
 * chosen client. `clients` is null for an in-house team.
 */
export function useJobsListController(rows: JobRow[], clients: ClientOption[] | null) {
  const params = useSearchParams();
  const filter = parseFilter(params.get('filter'));
  const client = parseClient(params.get('client'), clients);
  const scoped = filterByClient(rows, client);
  return {
    status: 'ready' as const,
    filter,
    counts: filterCounts(scoped),
    total: rows.length,
    rows: filterJobs(scoped, filter),
    onFilterChange: (next: JobFilter) => replaceInUrl('filter', next === 'all' ? '' : next),
    clients,
    client,
    onClientChange: (next: string) => replaceInUrl('client', next),
  };
}
