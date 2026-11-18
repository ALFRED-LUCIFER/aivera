import { useTranslations } from '@aivera/i18n/react';
import type { JobType } from '@aivera/jobs';
import { buttonClassName, Card, FilterTabs, Input, Label } from '@aivera/ui';
import Link from 'next/link';
import { useId } from 'react';
import { jobsHref, type Filter } from '../domain/jobs-list.ts';

export type JobCardData = {
  slug: string;
  title: string;
  descriptor: string;
  location: string | null;
  jobType: JobType;
  postedDays: number;
};

export type JobsListProps = {
  q: string;
  filter: Filter;
  chips: { value: Filter; count: number }[];
  jobs: JobCardData[];
  page: number;
  pageCount: number;
  onFilterChange: (filter: string) => void;
};

const link = 'font-semibold text-text underline-offset-4 hover:underline';

export function JobsList({ q, filter, chips, jobs, page, pageCount, onFilterChange }: JobsListProps) {
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
            <Input id={searchId} type="search" name="q" defaultValue={q} maxLength={100} />
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
        <ul className="mt-6 grid gap-3">
          {jobs.map((job) => (
            <li key={job.slug}>
              <Card level={2} title={job.title}>
                <p className="text-text-2">
                  {job.location
                    ? t('candidate.jobs.descriptorAndLocation', { descriptor: job.descriptor, location: job.location })
                    : job.descriptor}
                </p>
                <p className="mt-1 flex flex-wrap gap-x-3 text-meta text-text-2">
                  <span>{t(`jobTypes.${job.jobType}.label`)}</span>
                  <span>{t('candidate.jobs.posted', { days: job.postedDays })}</span>
                </p>
                <Link
                  href={`/candidates/jobs/${job.slug}`}
                  className={`${link} mt-3 inline-flex min-h-10 items-center`}
                >
                  {t('candidate.jobs.viewJob')}
                  <span className="sr-only">{t('candidate.jobs.viewJobFor', { title: job.title })}</span>
                </Link>
              </Card>
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
