import { useRouter } from 'next/navigation';
import { useOptimistic, useTransition } from 'react';
import { jobsHref, type Filter } from '../domain/jobs-list.ts';

/**
 * The chips change the URL (replace, so each arrow press adds no history) and the server renders the filtered list.
 * The chosen chip shows as checked at once, and the list is marked busy, until that render arrives.
 */
export function useJobFiltersController(q: string, filter: Filter) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [shown, show] = useOptimistic(filter);
  return {
    filter: shown,
    pending,
    onFilterChange: (next: string) =>
      startTransition(() => {
        show(next as Filter);
        router.replace(jobsHref({ q, filter: next as Filter }), { scroll: false });
      }),
  };
}
