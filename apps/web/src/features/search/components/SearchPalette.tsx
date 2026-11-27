'use client';

// AIV-P1-049: the top-bar search, from the Desk and Main artboards' search field (docs/01-design/artboards/Desk.dc.html).
// No artboard draws the results. Deviations:
// - the field is a button that looks like the artboard's field and opens a palette (the shared Dialog) with the real
//   search box: one keyboard path, and "/" opens it too;
// - it reads "Search jobs and candidates", not "Search roles, candidates, evidence": the catalogue never calls a job a
//   role, and evidence by meaning is AIV-P1-162 (#662), so nothing is claimed that cannot be found;
// - the results are Jobs and Candidates only, for the same reason;
// - the field's text is text-2, not the artboard's placeholder text-3: it is a button's label, which must meet 4.5:1;
// - results are links in two headed lists: Tab reaches each, Enter in the box opens the first (native elements, no
//   hand-made listbox).
import { useTranslations } from '@credalent/i18n/react';
import { Dialog, Input, Label } from '@credalent/ui';
import type { Route } from 'next';
import Link from 'next/link';
import { useId } from 'react';
import { resultHrefs, type SearchView } from '../domain/search.ts';

const icon = (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    className="size-4 shrink-0 text-text-3"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);

const result =
  'flex min-h-10 items-center rounded-control px-3 py-1.5 font-semibold text-text pointer-coarse:min-h-11 ' +
  'hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

export function SearchPalette({ view }: { view: SearchView }) {
  const t = useTranslations('search');
  const id = useId();
  const { jobs, candidates } = view.results;
  const found = resultHrefs(view.results).length;
  const announcement =
    view.status === 'searching'
      ? t('searching')
      : view.status === 'error'
        ? t('error')
        : view.status === 'done'
          ? found > 0
            ? t('found', { count: found })
            : t('nothing', { query: view.query.trim() })
          : '';
  return (
    <Dialog
      open={view.open}
      onOpenChange={view.onOpenChange}
      title={t('title')}
      closeLabel={t('close')}
      className="sm:max-w-xl"
      // Typing goes straight into the box, whether opened from the field or with "/".
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        document.getElementById(`${id}-input`)?.focus();
      }}
      trigger={
        <button
          type="button"
          className="flex h-10 w-full min-w-0 items-center gap-2 rounded-control border border-border-strong bg-surface px-3 text-start text-body text-text-2 pointer-coarse:h-11 hover:border-border-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          aria-keyshortcuts="/"
        >
          {icon}
          <span className="truncate">{t('placeholder')}</span>
        </button>
      }
    >
      <div className="flex flex-col gap-3">
        <Label htmlFor={`${id}-input`} className="sr-only">
          {t('label')}
        </Label>
        <Input
          id={`${id}-input`}
          type="search"
          autoComplete="off"
          placeholder={t('placeholder')}
          value={view.query}
          onChange={(event) => view.onQueryChange(event.target.value)}
          onKeyDown={view.onKeyDown}
        />
        <output aria-live="polite" className="text-meta text-text-2">
          {announcement}
        </output>
        {jobs.length > 0 && (
          <section aria-labelledby={`${id}-jobs`}>
            <h3 id={`${id}-jobs`} className="px-3 pb-1 text-meta font-semibold text-text-2">
              {t('groups.jobs')}
            </h3>
            <ul>
              {jobs.map((job) => (
                <li key={job.id}>
                  {/* The hrefs are built from opaque ids, which typed routes cannot check. */}
                  <Link href={job.href as Route} className={result} onClick={view.onChosen}>
                    {job.title}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
        {candidates.length > 0 && (
          <section aria-labelledby={`${id}-candidates`}>
            <h3 id={`${id}-candidates`} className="px-3 pb-1 text-meta font-semibold text-text-2">
              {t('groups.candidates')}
            </h3>
            <ul>
              {candidates.map((person) => (
                <li key={person.personId}>
                  <Link href={person.href as Route} className={result} onClick={view.onChosen}>
                    {t('candidate', { name: person.name, job: person.job })}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </Dialog>
  );
}
