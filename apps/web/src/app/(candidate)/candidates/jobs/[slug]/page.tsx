import { defaultLocale, defaultTimeZone, formatAmount, formatMoney, getTranslations } from '@credalent/i18n';
import { jobTypeLabel, SLUG } from '@credalent/jobs';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { postedDaysAgo } from '@/features/public-jobs/domain/jobs-list.ts';
import { getCatalogue } from '@/server/jobs';
import { getPublicJobs } from '@/server/publicJobs';
import { JobDetailView } from './JobDetailView.tsx';

type Props = PageProps<'/candidates/jobs/[slug]'>;

// One read per request, shared by the title and the page. An open job only: a job taken down, or a slug no job had,
// renders not-found.tsx ("This job is no longer open") with a 404.
const openJob = cache(async (slug: string) => {
  // Slugs are at most 60 characters of title plus 13 of tail (slugFor); a longer one is no job, so skip the read.
  const found = slug.length <= 100 && SLUG.test(slug) ? await getPublicJobs().findPublicJob(slug) : null;
  return found?.open ? found.job : null;
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const job = await openJob((await params).slug);
  if (job) return { title: job.title };
  return { title: (await getTranslations(defaultLocale, defaultTimeZone))('candidate.job.closedTitle') };
}

// Public: one job's needs, levels and how candidates are judged (AIV-P3-005), read as aivera_public. One template for
// every job type: the competencies and evidence wording come from the read model.
export default async function JobPage({ params }: Props) {
  const job = await openJob((await params).slug);
  if (!job) notFound();
  const [t, catalogue] = await Promise.all([
    getTranslations(defaultLocale, defaultTimeZone),
    getCatalogue().getPublishedCatalogue(),
  ]);
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
      jobTypeLabel={jobTypeLabel(catalogue, job.jobType)}
      pay={pay}
      // shortcut: the system clock, not the injected Clock port (AGENTS.md 3.9); take it from the port when the web app
      // has one.
      postedDays={postedDaysAgo(job.postedAt, new Date())}
      competencies={job.competencies}
    />
  );
}
