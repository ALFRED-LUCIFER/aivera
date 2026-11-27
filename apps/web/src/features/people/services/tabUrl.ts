import { ALL_JOBS } from '../domain/people.ts';

// Keeps the job tab in the URL without a server round trip, as the Jobs list keeps its filter.
export function replaceTabInUrl(tab: string) {
  const url = new URL(window.location.href);
  if (tab === ALL_JOBS) url.searchParams.delete('job');
  else url.searchParams.set('job', tab);
  window.history.replaceState(null, '', url);
}
