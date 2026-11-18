import { useTranslations } from '@aivera/i18n/react';
import type { JobType } from '@aivera/jobs';
import { Button, buttonClassName, Card, Chip } from '@aivera/ui';
import Link from 'next/link';

export type JobDetailProps = {
  title: string;
  descriptor: string;
  location: string | null;
  jobType: JobType;
  /** "AED 35,000 to 48,000 a month" or "Pay band not disclosed", formatted on the server. */
  pay: string;
  postedDays: number;
  competencies: { name: string; evidenceExpected: string; levelNeeded: number }[];
  cvCheckHref: `/candidates/cv-check?job=${string}`;
  applyHref: `/candidates/jobs/${string}/apply`;
};

const section = 'font-display text-section tracking-tight';

export function JobDetail(props: JobDetailProps) {
  const t = useTranslations();
  const { title, descriptor, location, jobType, pay, postedDays, competencies } = props;
  return (
    <article className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="flex min-w-0 flex-col gap-8">
        <header className="flex flex-col gap-2">
          <h1 className="font-display text-title tracking-tight">{title}</h1>
          <p className="text-text-2">
            {location ? t('candidate.jobs.descriptorAndLocation', { descriptor, location }) : descriptor}
          </p>
          <p className="flex flex-wrap gap-x-4 text-meta text-text-2">
            <span>{t(`jobTypes.${jobType}.label`)}</span>
            <span>{pay}</span>
            <span>{t('candidate.jobs.posted', { days: postedDays })}</span>
          </p>
        </header>

        <section aria-labelledby="needs" className="flex flex-col gap-3">
          <h2 id="needs" className={section}>
            {t('candidate.job.needsTitle')}
          </h2>
          <p className="text-text-2">{t('candidate.job.needsIntro')}</p>
          <ul className="divide-y divide-border rounded-card border border-border bg-surface">
            {competencies.map((c, i) => (
              <li key={i} className="flex flex-col gap-1 p-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
                <div className="min-w-0">
                  <h3 className="text-card text-text">{c.name}</h3>
                  <p className="mt-1 text-text-2">
                    <span className="sr-only">{t('candidate.job.evidence')} </span>
                    {c.evidenceExpected}
                  </p>
                </div>
                <p className="shrink-0 font-semibold tabular-nums text-text">
                  <span className="sr-only">{t('candidate.job.levelLabel')} </span>
                  {t('candidate.job.level', { level: c.levelNeeded })}
                </p>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="judged" className="flex flex-col gap-3">
          <h2 id="judged" className={section}>
            {t('candidate.job.judgedTitle')}
          </h2>
          <ul className="flex list-disc flex-col gap-1.5 ps-5 text-text">
            <li>{t('candidate.job.judgedWork')}</li>
            <li>{t('candidate.job.judgedClaims')}</li>
            <li>{t('candidate.job.judgedPerson')}</li>
          </ul>
        </section>
      </div>

      <aside className="flex flex-col gap-4">
        <Card level={2} title={t('candidate.job.beforeTitle')}>
          <p className="text-text-2">{t('candidate.job.beforeBody')}</p>
          <div className="mt-4 flex flex-col gap-2">
            <Link href={props.applyHref} className={buttonClassName('primary')}>
              {t('candidate.job.apply')}
            </Link>
            <Link href={props.cvCheckHref} className={buttonClassName('secondary')}>
              {t('candidate.job.checkCv')}
            </Link>
          </div>
        </Card>
        <Card
          level={2}
          title={
            <span className="flex items-center justify-between gap-2">
              {t('candidate.job.gapTitle')}
              <Chip>{t('candidate.job.plus')}</Chip>
            </span>
          }
        >
          <p className="text-text-2">{t('candidate.job.gapBody')}</p>
          <Link
            href="/candidates/plans"
            className="mt-3 inline-flex min-h-10 items-center font-semibold underline-offset-4 hover:underline"
          >
            {t('candidate.job.gapLink')}
          </Link>
        </Card>
      </aside>
    </article>
  );
}

/** The job could not be read (error.tsx): a way to try again, and back to the list. */
export function JobDetailFailed({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations('candidate.job');
  return (
    <div className="flex flex-col items-start gap-3">
      <p role="alert" className="text-text-2">
        {t('failed')}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={onRetry}>{t('retry')}</Button>
        <Link href="/candidates/jobs" className={buttonClassName('ghost')}>
          {t('allJobs')}
        </Link>
      </div>
    </div>
  );
}
