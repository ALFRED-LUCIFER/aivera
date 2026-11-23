import { useTranslations } from '@credalent/i18n/react';
import { buttonClassName, Input, Label, LevelMeter } from '@credalent/ui';
import Link from 'next/link';
import { useId, type CSSProperties, type ReactNode } from 'react';
import type { JobCardData } from '@/features/public-jobs/index.ts';

// Deviation from the CHome artboard: no "Check my CV, free" button until the CV check is built (AIV-P1-095).
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

// The hero rises in 120 ms steps and the highlighter sweeps over the promise (marketing.css, off under reduced motion).
const step = (n: number) => ({ '--mk-step': n }) as CSSProperties;
const mark = (chunks: ReactNode) => (
  <mark className="mk-sweep rounded-tag bg-hl px-2 text-hl-text box-decoration-clone">{chunks}</mark>
);
const display = 'font-display font-bold tracking-[-0.025em] text-balance';

const arrow = (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    className="size-4.5 flex-none transition-transform duration-120 ease-case group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5 motion-reduce:transition-none rtl:-scale-x-100"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

/** The candidate home page (artboard CHome): hero and sample job, principles, New this week and the Plus teaser. */
export function CandidateHome({ newJobs, plusPrice }: CandidateHomeProps) {
  const t = useTranslations();
  const searchId = useId();
  return (
    <div className="flex flex-col gap-7">
      <section className="flex flex-wrap items-center gap-x-14 gap-y-10 py-[clamp(16px,3vw,40px)]">
        <div className="flex min-w-0 flex-[6_1_420px] flex-col gap-5.5">
          <h1
            className="mk-rise font-display text-[clamp(40px,5.6vw,72px)] leading-[1.03] font-bold tracking-[-0.035em] text-balance"
            style={step(0)}
          >
            {t.rich('candidate.home.title', { mark })}
          </h1>
          <p className="mk-rise max-w-[52ch] text-[clamp(17px,1.5vw,20px)] leading-normal text-text-2" style={step(1)}>
            {t('candidate.home.lead')}
          </p>
          {/* A GET form to the jobs list: "Find jobs" lands on the list filtered by the words typed. */}
          <search className="mk-rise" style={step(2)}>
            <form action="/candidates/jobs" className="flex max-w-140 flex-wrap gap-2">
              <div className="min-w-0 flex-[1_1_240px]">
                <Label htmlFor={searchId} className="sr-only">
                  {t('candidate.jobs.searchLabel')}
                </Label>
                <Input
                  id={searchId}
                  type="search"
                  name="q"
                  maxLength={100}
                  placeholder={t('candidate.jobs.searchLabel')}
                  className="min-h-11"
                />
              </div>
              <button type="submit" className={`group ${buttonClassName('primary', 'touch')}`}>
                {t('candidate.home.findJobs')}
                {arrow}
              </button>
            </form>
          </search>
          <p className="mk-rise text-text-2" style={step(3)}>
            {t('candidate.home.free')}
          </p>
        </div>
        <div className="mk-rise min-w-0 flex-[5_1_360px]" style={step(4)}>
          <section
            aria-labelledby="sample"
            className="flex flex-col gap-3.5 rounded-card border border-border-strong bg-surface p-6 shadow-pop"
          >
            <div className="flex flex-col gap-0.5">
              {/* Named as an example, so the illustration is never read as a real listing. */}
              <h2 id="sample" className="text-card">
                <span className="text-text-2">{t('candidate.home.sampleExample')}</span>{' '}
                {t('candidate.home.sampleTitle')}
              </h2>
              <p className="text-meta text-text-2">{t('candidate.home.sampleJob')}</p>
            </div>
            <ul>
              {SAMPLE.map(([key, level]) => (
                <li
                  key={key}
                  className="flex items-center justify-between gap-3 border-t border-border py-2.5 font-medium"
                >
                  <span>{t(`candidate.home.sample.${key}`)}</span>
                  <LevelMeter level={level} label={t('candidate.job.level', { level })} />
                </li>
              ))}
            </ul>
            <p className="text-meta text-text-2">{t('candidate.job.needsIntro')}</p>
          </section>
        </div>
      </section>

      <section aria-labelledby="principles">
        {/* Named for screen readers; the artboard shows the three principles without a heading. */}
        <h2 id="principles" className="sr-only">
          {t('candidate.home.principlesTitle')}
        </h2>
        <ul className="grid grid-cols-[repeat(auto-fit,minmax(min(250px,100%),1fr))] gap-x-10 gap-y-8">
          {PRINCIPLES.map((key) => (
            <li key={key} className="flex flex-col gap-2">
              <span aria-hidden="true" className="mb-3 block h-0.5 bg-text" />
              <h3 className="text-section">{t(`candidate.home.principles.${key}.title`)}</h3>
              <p className="text-[16px] leading-6 text-text-2">{t(`candidate.home.principles.${key}.body`)}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="new-jobs" className="min-w-0 rounded-card border border-border bg-surface shadow-1">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5 pb-3.5">
          <h2 id="new-jobs" className={`${display} text-[20px] leading-[1.15]`}>
            {t('candidate.home.newTitle')}
          </h2>
          <Link
            href="/candidates/jobs"
            className="inline-flex min-h-10 items-center font-medium text-text underline underline-offset-4"
          >
            {t('candidate.home.allJobs')}
          </Link>
        </div>
        {newJobs === null ? (
          <p role="alert" className="border-t border-border px-5 py-4.5 text-text-2">
            {t('candidate.jobs.failed')}
          </p>
        ) : newJobs.length === 0 ? (
          <p className="border-t border-border px-5 py-4.5 text-text-2">{t('candidate.home.noNew')}</p>
        ) : (
          // A row, not JobCard: the artboard lays New this week out as a list inside one card.
          <ul>
            {newJobs.map((job) => (
              <li
                key={job.slug}
                className="flex flex-wrap items-center gap-x-6 gap-y-2.5 border-t border-border px-5 py-4.5"
              >
                <div className="flex min-w-0 flex-[1_1_280px] flex-col gap-1">
                  <h3 className="text-[17px] leading-6 font-semibold">
                    <Link
                      href={`/candidates/jobs/${job.slug}`}
                      className="text-text underline-offset-4 hover:underline"
                    >
                      {job.title}
                    </Link>
                  </h3>
                  <p className="text-text-2">
                    {job.location
                      ? t('candidate.jobs.descriptorAndLocation', {
                          descriptor: job.descriptor,
                          location: job.location,
                        })
                      : job.descriptor}
                  </p>
                </div>
                <span className="inline-flex h-6 items-center rounded-tag border border-border bg-surface-subtle px-2 text-meta font-medium whitespace-nowrap text-text-2">
                  {job.jobTypeLabel}
                </span>
                <span className="min-w-22.5 text-meta text-text-2 tabular-nums">
                  {t('candidate.jobs.posted', { days: job.postedDays })}
                </span>
                {/* The visible words lead the name, so voice users can say what they see (WCAG 2.5.3). */}
                <Link
                  href={`/candidates/jobs/${job.slug}`}
                  aria-label={t('candidate.jobs.viewJobFor', { title: job.title })}
                  className={buttonClassName('secondary')}
                >
                  {t('candidate.jobs.viewJob')}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* An ink panel (dark tokens in either theme), like the website's pilot band. */}
      <section
        data-theme="dark"
        aria-labelledby="plus"
        className="flex flex-wrap items-center justify-between gap-x-12 gap-y-6 rounded-card bg-surface p-[clamp(28px,4vw,48px)] text-text"
      >
        <div className="flex min-w-0 flex-[3_1_380px] flex-col gap-3">
          <h2 id="plus" className={`${display} text-[clamp(26px,3vw,36px)] leading-[1.15]`}>
            {t('candidate.home.plusTitle')}
          </h2>
          <p className="max-w-[56ch] text-[17px] leading-6.5 text-text-2">
            {t('candidate.home.plusBody', { price: plusPrice })}
          </p>
        </div>
        {/* Deviation from the CHome artboard: no "See what Plus adds" call to action until Plans is built (AIV-P1-095). */}
      </section>
    </div>
  );
}
