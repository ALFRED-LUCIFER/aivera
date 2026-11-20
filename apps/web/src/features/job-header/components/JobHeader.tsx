import { useTranslations } from '@credalent/i18n/react';
import { StatusBadge } from '@credalent/ui';
import type { Route } from 'next';
import Link from 'next/link';
import { rubricLabel } from '@/features/jobs-list/domain/jobsList.ts';
import { jobPageHref, type JobHeaderView, type JobPage } from '../domain/jobHeader.ts';

const check = (
  <svg aria-hidden="true" viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="m3.5 8.5 3 3 6-7" />
  </svg>
);

/** Every job page's header (AIV-P1-011): breadcrumb, title, where the job stands, and its five stages as links. */
export function JobHeader({ view, current }: { view: JobHeaderView; current: JobPage | null }) {
  const t = useTranslations();
  const meta = [
    view.team,
    view.location,
    view.hiringOwner ? t('jobHeader.hiringOwner', { name: view.hiringOwner }) : t('jobHeader.noHiringOwner'),
    view.assessed === null ? null : t('jobHeader.assessed', { count: view.assessed }),
  ].filter(Boolean);
  return (
    <div className="mb-6 flex flex-col gap-6">
      <div className="flex flex-col gap-2.5">
        <nav aria-label={t('jobHeader.breadcrumb')} className="flex flex-wrap gap-1.5 text-meta text-text-2">
          <Link href="/app/jobs" className="underline underline-offset-2 hover:text-text">
            {t('shell.nav.jobs')}
          </Link>
          <span aria-hidden="true">{'/'}</span>
          <span aria-current="page">{view.title}</span>
        </nav>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h1 className="font-display text-title tracking-tight">{view.title}</h1>
            <p className="max-w-[72ch] text-body text-text-2">{meta.join(' · ')}</p>
          </div>
          <StatusBadge
            status={view.rubric.approved ? 'supported' : 'needsValidation'}
            label={t(`jobsList.rubric.${rubricLabel(view.rubric)}`)}
          />
        </div>
      </div>
      <nav aria-label={t('jobHeader.stagesLabel')}>
        <ol className="flex flex-wrap gap-2">
          {view.stages.map(({ page, line, done }) => {
            const isCurrent = page === current;
            return (
              <li key={page} className="min-w-0 flex-[1_1_170px]">
                <Link
                  href={jobPageHref(view.jobId, page) as Route}
                  aria-current={isCurrent ? 'page' : undefined}
                  className={`flex min-h-14 items-center gap-2.5 rounded-control border px-3 py-2 text-text transition-colors duration-120 ease-case motion-reduce:transition-none hover:border-text-3 ${isCurrent ? 'border-text bg-surface' : 'border-border'}`}
                >
                  <span
                    aria-hidden="true"
                    className={`grid size-6 flex-none place-items-center rounded-full ${done ? 'bg-action text-on-action' : 'border-[1.5px] border-border-strong'}`}
                  >
                    {done && check}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className={isCurrent ? 'font-semibold' : 'font-medium'}>{t(`jobHeader.stages.${page}`)}</span>
                    <span className="text-meta text-text-2">
                      {'values' in line
                        ? t(`jobHeader.status.${line.key}`, line.values)
                        : t(`jobHeader.status.${line.key}`)}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      </nav>
    </div>
  );
}
