import type { JobFilter } from '../domain/jobsList.ts';

// Keeps the filter in the URL without a server round trip. Next syncs useSearchParams only when the state is not its own.
export function replaceFilterInUrl(filter: JobFilter) {
  const url = new URL(window.location.href);
  if (filter === 'all') url.searchParams.delete('filter');
  else url.searchParams.set('filter', filter);
  window.history.replaceState(null, '', url);
}
