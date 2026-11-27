import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { resultHrefs, type SearchResults, type SearchView } from '../domain/search.ts';
import * as actions from '../services/searchWorkspace.ts';

const NONE: SearchResults = { jobs: [], candidates: [] };
/** Debounce: a search runs once typing pauses (AIV-P1-049). */
export const SEARCH_DELAY_MS = 200;

/** Whether a "/" keypress came from somewhere a person types, where it must stay a slash. */
const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

/**
 * The top-bar search palette (AIV-P1-049): opened from the top bar or "/", searched as typing pauses; Enter opens the
 * first result and Tab reaches each result's link. A reply to an older query is dropped.
 */
export function useSearchController(services: Pick<typeof actions, 'searchWorkspace'> = actions): SearchView {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<SearchView['status']>('idle');
  const [results, setResults] = useState<SearchResults>(NONE);
  const latest = useRef(0);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey || typing(event.target)) return;
      event.preventDefault();
      setOpen(true);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return {
    open,
    onOpenChange(next) {
      setOpen(next);
      if (!next) {
        latest.current += 1;
        setQuery('');
        setStatus('idle');
        setResults(NONE);
      }
    },
    query,
    onQueryChange(next) {
      setQuery(next);
      const request = ++latest.current;
      if (!next.trim()) {
        setStatus('idle');
        setResults(NONE);
        return;
      }
      setStatus('searching');
      setTimeout(async () => {
        if (request !== latest.current) return;
        const found = await services.searchWorkspace({ query: next }).catch(() => null);
        if (request !== latest.current) return;
        setResults(found ?? NONE);
        setStatus(found ? 'done' : 'error');
      }, SEARCH_DELAY_MS);
    },
    status,
    results,
    onKeyDown(event) {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      const [first] = resultHrefs(results);
      if (!first) return;
      setOpen(false);
      // The hrefs are built from opaque ids, which typed routes cannot check.
      router.push(first as Route);
    },
    onChosen: () => setOpen(false),
  };
}
