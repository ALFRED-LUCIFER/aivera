import { useSearchParams } from 'next/navigation';
import { parseTab, peopleOnTab, type PeopleData } from '../domain/people.ts';
import { replaceTabInUrl } from '../services/tabUrl.ts';

/** Candidates (all jobs): the job tab from the URL and the rows it shows. */
export function usePeopleController(data: PeopleData) {
  const tab = parseTab(useSearchParams().get('job'), data);
  return {
    status: 'ready' as const,
    data,
    tab,
    rows: peopleOnTab(data, tab),
    onTabChange: replaceTabInUrl,
  };
}
