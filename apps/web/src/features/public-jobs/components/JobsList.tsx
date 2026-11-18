import { useTranslations } from '@aivera/i18n/react';
import { Button, buttonClassName, Card, FilterTabs, Input, Label } from '@aivera/ui';
import Link from 'next/link';
import { useId } from 'react';
import { jobsHref, type Filter, type JobCardData } from '../domain/jobs-list.ts';
import { JobCard } from './JobCard.tsx';

export type JobsListProps = {
  q: string;
  filter: Filter;
  chips: { value: Filter; count: number }[];
  jobs: JobCardData[];
  page: number;
  pageCount: number;
  /** True while a chosen chip waits for the server's list. */
  pending?: boolean;
  onFilterChange: (filter: string) => void;
};

const link = 'font-semibold text-text underline-offset-4 hover:underline';

export function JobsList({ q, filter, chips, jobs, page, pageCount, pending = false, onFilterChange }: JobsListProps) {
  const t = useTranslations();
  const searchId = useId();
  return (
    <>
      <h1 className="font-display text-title tracking-tight">{t('candidate.jobs.title')}</h1>
      <p className="mt-2 text-text-2">{t('candidate.jobs.intro')}</p>
      {/* A plain GET form: the search works before any script runs, and the URL holds it, so links can be shared. */}
      <search className="mt-6">
        <form action="/candidates/jobs" className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-0 flex-1 basis-64 flex-col gap-1.5">
            <Label htmlFor={searchId}>{t('candidate.jobs.searchLabel')}</Label>
            {/* Keyed on the query: a client navigation (Clear filters, paging) keeps this input, so its value must follow q. */}
            <Input key={q} id={searchId} type="search" name="q" defaultValue={q} maxLength={100} />
          </div>
          {filter !== 'all' && <input type="hidden" name="filter" value={filter} />}
          <button type="submit" className={buttonClassName('primary')}>
            {t('candidate.jobs.search')}
          </button>
        </form>
      </search>
      <div className="mt-6">
        <FilterTabs
          label={t('candidate.jobs.filtersLabel')}
          value={filter}
          onValueChange={onFilterChange}
          tabs={chips.map(({ value, count }) => ({ value, count, label: t(`candidate.jobs.filters.${value}`) }))}
        />
      </div>
      {jobs.length === 0 ? (
        <div className="mt-8 flex flex-col items-start gap-3">
          <p className="text-text-2">{t('candidate.jobs.empty')}</p>
          <Link href={jobsHref({})} className={buttonClassName('secondary')}>
            {t('candidate.jobs.clearFilters')}
          </Link>
        </div>
      ) : (
        <ul aria-busy={pending || undefined} className="mt-6 grid gap-3">
          {jobs.map((job) => (
            <li key={job.slug}>
              <JobCard job={job} />
            </li>
          ))}
        </ul>
      )}
      {pageCount > 1 && (
        <nav aria-label={t('candidate.jobs.pages')} className="mt-6 flex flex-wrap items-center gap-4">
          {page > 1 && (
            <Link href={jobsHref({ q, filter, page: page - 1 })} className={link}>
              {t('candidate.jobs.previous')}
            </Link>
          )}
          <span className="text-meta text-text-2">{t('candidate.jobs.pageOf', { page, pageCount })}</span>
          {page < pageCount && (
            <Link href={jobsHref({ q, filter, page: page + 1 })} className={link}>
              {t('candidate.jobs.next')}
            </Link>
          )}
        </nav>
      )}
    </>
  );
}

/** The list while the server reads the jobs (loading.tsx). */
export function JobsListLoading() {
  const t = useTranslations('candidate.jobs');
  return (
    <>
      <h1 className="font-display text-title tracking-tight">{t('title')}</h1>
      <p className="mt-2 text-text-2">{t('intro')}</p>
      <Card className="mt-6" loading loadingLabel={t('loading')} />
    </>
  );
}

/** The jobs could not be read (error.tsx): the frame stays, with a way to try again. */
export function JobsListFailed({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations('candidate.jobs');
  return (
    <div className="flex flex-col items-start gap-3">
      <h1 className="font-display text-title tracking-tight">{t('title')}</h1>
      <p role="alert" className="text-text-2">
        {t('failed')}
      </p>
      <Button onClick={onRetry}>{t('retry')}</Button>
    </div>
  );
}
