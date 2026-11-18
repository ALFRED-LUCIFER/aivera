import { useRouter } from 'next/navigation';
import { jobsHref, type Filter } from '../domain/jobs-list.ts';

/** The chips change the URL (replace, so each arrow press adds no history); the server renders the filtered list. */
export function useJobFiltersController(q: string) {
  const router = useRouter();
  return { onFilterChange: (filter: string) => router.replace(jobsHref({ q, filter: filter as Filter })) };
}
