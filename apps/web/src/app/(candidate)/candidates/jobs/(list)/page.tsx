import { defaultLocale, defaultTimeZone, getTranslations } from '@aivera/i18n';
import { jobTypeLabel } from '@aivera/jobs';
import type { Metadata } from 'next';
import { jobsListView, parseJobsQuery, postedDaysAgo } from '@/features/public-jobs/domain/jobs-list.ts';
import { getCatalogue } from '@/server/jobs';
import { getPublicJobs } from '@/server/publicJobs';
import { PublicJobs } from './PublicJobs.tsx';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations(defaultLocale, defaultTimeZone))('candidate.jobs.title') };
}

// Public: the candidate site's jobs list (AIV-P3-004), read as aivera_public; a failed read renders error.tsx.
// shortcut: search, chips and paging run over every open job in memory; move them into SQL on jobs.public_job when
// the open jobs pass a few hundred.
export default async function JobsPage({ searchParams }: PageProps<'/candidates/jobs'>) {
  const query = parseJobsQuery(await searchParams);
  const [jobs, catalogue] = await Promise.all([
    getPublicJobs().listPublicJobs(),
    getCatalogue().getPublishedCatalogue(),
  ]);
  const view = jobsListView(jobs, query);
  // shortcut: the system clock, not the injected Clock port (AGENTS.md 3.9); take it from the port when the web app
  // has one.
  const now = new Date();
  return (
    <PublicJobs
      q={query.q}
      filter={query.filter}
      chips={view.chips}
      page={view.page}
      pageCount={view.pageCount}
      jobs={view.jobs.map(({ slug, title, descriptor, location, jobType, postedAt }) => ({
        slug,
        title,
        descriptor,
        location,
        jobTypeLabel: jobTypeLabel(catalogue, jobType),
        postedDays: postedDaysAgo(postedAt, now),
      }))}
    />
  );
}
