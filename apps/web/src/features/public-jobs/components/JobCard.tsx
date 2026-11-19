import { useTranslations } from '@aivera/i18n/react';
import { Card } from '@aivera/ui';
import Link from 'next/link';
import type { JobCardData } from '../domain/jobs-list.ts';

const link = 'font-semibold text-text underline-offset-4 hover:underline';

/** One open job: title, who and where, job type, posted age and "View job". Used by the jobs list. */
export function JobCard({ job }: { job: JobCardData }) {
  const t = useTranslations();
  return (
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
      {/* The visible words lead the name, so voice users can say what they see (WCAG 2.5.3). */}
      <Link
        href={`/candidates/jobs/${job.slug}`}
        aria-label={t('candidate.jobs.viewJobFor', { title: job.title })}
        className={`${link} mt-3 inline-flex min-h-10 items-center`}
      >
        {t('candidate.jobs.viewJob')}
      </Link>
    </Card>
  );
}
