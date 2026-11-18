import { defaultLocale, defaultTimeZone, formatAmount, formatMoney, getTranslations } from '@aivera/i18n';
import { SLUG } from '@aivera/jobs';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { applyHref } from '@/features/candidate-shell/domain/links.ts';
import { postedDaysAgo } from '@/features/public-jobs/domain/jobs-list.ts';
import { getPublicJobs } from '@/server/publicJobs';
import { JobDetailView } from './JobDetailView.tsx';

type Props = PageProps<'/candidates/jobs/[slug]'>;

// One read per request, shared by the title and the page. An open job only: a job taken down, or a slug no job had,
// renders not-found.tsx ("This job is no longer open") with a 404.
const openJob = cache(async (slug: string) => {
  const found = slug.length <= 100 && SLUG.test(slug) ? await getPublicJobs().findPublicJob(slug) : null;
  return found?.open ? found.job : null;
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const job = await openJob((await params).slug);
  return job ? { title: job.title } : {};
}

// Public: one job's needs, levels and how candidates are judged (AIV-P3-005), read as aivera_public. One template for
// every job type: the competencies and evidence wording come from the read model.
export default async function JobPage({ params }: Props) {
  const job = await openJob((await params).slug);
  if (!job) notFound();
  const t = await getTranslations(defaultLocale, defaultTimeZone);
  const pay = job.payBand
    ? t('money.monthlyRange', {
        min: formatMoney({ amountMinor: job.payBand.minMinor, currency: job.payBand.currency }, defaultLocale),
        max: formatAmount({ amountMinor: job.payBand.maxMinor, currency: job.payBand.currency }, defaultLocale),
      })
    : t('candidate.job.payNotDisclosed');
  return (
    <JobDetailView
      title={job.title}
      descriptor={job.descriptor}
      location={job.location}
      jobType={job.jobType}
      pay={pay}
      postedDays={postedDaysAgo(job.postedAt, new Date())}
      competencies={job.competencies}
      cvCheckHref={`/candidates/cv-check?job=${job.slug}`}
      applyHref={applyHref(job.slug)}
    />
  );
}
