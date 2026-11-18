import { useSearchParams } from 'next/navigation';
import { filterCounts, filterJobs, parseFilter, type JobFilter, type JobRow } from '../domain/jobsList.ts';
import { replaceFilterInUrl } from '../services/filterUrl.ts';

/** The Jobs list: the filter from the URL, the rows it shows, and each tab's count. */
export function useJobsListController(rows: JobRow[]) {
  const filter = parseFilter(useSearchParams().get('filter'));
  return {
    status: 'ready' as const,
    filter,
    counts: filterCounts(rows),
    total: rows.length,
    rows: filterJobs(rows, filter),
    onFilterChange: (next: JobFilter) => replaceFilterInUrl(next),
  };
}
