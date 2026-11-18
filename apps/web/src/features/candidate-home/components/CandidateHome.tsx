import { useTranslations } from '@aivera/i18n/react';
import { buttonClassName, Card, Input, Label } from '@aivera/ui';
import Link from 'next/link';
import { useId } from 'react';
import { JobCard, type JobCardData } from '@/features/public-jobs/index.ts';

export type CandidateHomeProps = {
  /** Up to three newest open jobs; null when the jobs could not be read (the rest of the page still renders). */
  newJobs: JobCardData[] | null;
  /** "AED 49 a month", formatted on the server. */
  plusPrice: string;
};

// The sample card's rows (artboard CHome): what the Senior AI Engineer listing shows, as an example, not live data.
const SAMPLE = [
  ['llm', 4],
  ['retrieval', 4],
  ['python', 3],
  ['product', 3],
] as const;
const PRINCIPLES = ['needs', 'work', 'person'] as const;
const section = 'font-display text-section tracking-tight';

export function CandidateHome({ newJobs, plusPrice }: CandidateHomeProps) {
  const t = useTranslations();
  const searchId = useId();
  return (
    <div className="flex flex-col gap-12">
      <section className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex flex-col gap-4">
          <h1 className="font-display text-title tracking-tight">{t('candidate.home.title')}</h1>
          <p className="max-w-prose text-text-2">{t('candidate.home.lead')}</p>
          {/* A GET form to the jobs list: "Find jobs" lands on the list filtered by the words typed. */}
          <search>
            <form action="/candidates/jobs" className="flex flex-wrap items-end gap-3">
              <div className="flex min-w-0 flex-1 basis-64 flex-col gap-1.5">
                <Label htmlFor={searchId}>{t('candidate.jobs.searchLabel')}</Label>
                <Input id={searchId} type="search" name="q" maxLength={100} />
              </div>
              <button type="submit" className={buttonClassName('primary')}>
                {t('candidate.home.findJobs')}
              </button>
            </form>
          </search>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Link href="/candidates/cv-check" className={buttonClassName('secondary')}>
              {t('candidate.home.checkCv')}
            </Link>
            <p className="text-meta text-text-2">{t('candidate.home.free')}</p>
          </div>
        </div>
        <Card level={2} title={t('candidate.home.sampleTitle')}>
          <p className="text-meta text-text-2">{t('candidate.home.sampleJob')}</p>
          <ul className="mt-3 divide-y divide-border">
            {SAMPLE.map(([key, level]) => (
              <li key={key} className="flex items-baseline justify-between gap-4 py-2">
                <span>{t(`candidate.home.sample.${key}`)}</span>
                <span className="shrink-0 font-semibold tabular-nums">{t('candidate.job.level', { level })}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-meta text-text-2">{t('candidate.job.needsIntro')}</p>
        </Card>
      </section>

      <section aria-labelledby="principles" className="flex flex-col gap-4">
        <h2 id="principles" className={section}>
          {t('candidate.home.principlesTitle')}
        </h2>
        <ul className="grid gap-6 md:grid-cols-3">
          {PRINCIPLES.map((key) => (
            <li key={key} className="flex flex-col gap-1.5">
              <h3 className="text-card text-text">{t(`candidate.home.principles.${key}.title`)}</h3>
              <p className="text-text-2">{t(`candidate.home.principles.${key}.body`)}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="new-jobs" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="new-jobs" className={section}>
            {t('candidate.home.newTitle')}
          </h2>
          <Link
            href="/candidates/jobs"
            className="inline-flex min-h-10 items-center font-semibold underline-offset-4 hover:underline"
          >
            {t('candidate.home.allJobs')}
          </Link>
        </div>
        {newJobs === null ? (
          <p role="alert" className="text-text-2">
            {t('candidate.jobs.failed')}
          </p>
        ) : newJobs.length === 0 ? (
          <p className="text-text-2">{t('candidate.home.noNew')}</p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-3">
            {newJobs.map((job) => (
              <li key={job.slug}>
                <JobCard job={job} level={3} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <Card level={2} title={t('candidate.home.plusTitle')}>
        <p className="text-text-2">{t('candidate.home.plusBody')}</p>
        <p className="mt-2 font-semibold tabular-nums">{plusPrice}</p>
        <Link
          href="/candidates/plans"
          className="mt-2 inline-flex min-h-10 items-center font-semibold underline-offset-4 hover:underline"
        >
          {t('candidate.home.plusLink')}
        </Link>
      </Card>
    </div>
  );
}
