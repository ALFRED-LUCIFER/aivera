import { defaultLocale, defaultTimeZone, formatMoney, getTranslations } from '@aivera/i18n';
import { log } from '@aivera/observability';
import { newJobs } from '@/features/candidate-home/domain/new-jobs.ts';
import { postedDaysAgo } from '@/features/public-jobs/domain/jobs-list.ts';
import { getPublicJobs } from '@/server/publicJobs';
import { HomeView } from './HomeView.tsx';

// Public: the candidate home page (AIV-P3-003), server-rendered. If the jobs cannot be read the rest still renders and
// "New this week" says so; the log carries a code only.
export default async function CandidateHome() {
  const t = await getTranslations(defaultLocale, defaultTimeZone);
  const jobs = await getPublicJobs()
    .listPublicJobs()
    .catch(() => {
      log.error({ area: 'candidate-home', code: 'public_jobs_unavailable' }, 'public jobs read failed');
      return null;
    });
  const now = new Date();
  return (
    <HomeView
      newJobs={
        jobs &&
        newJobs(jobs).map(({ slug, title, descriptor, location, jobType, postedAt }) => ({
          slug,
          title,
          descriptor,
          location,
          jobType,
          postedDays: postedDaysAgo(postedAt, now),
        }))
      }
      // The Plus price (PRODUCT.md): AED 49 a month.
      plusPrice={t('money.monthly', { amount: formatMoney({ amountMinor: 4900, currency: 'AED' }, defaultLocale) })}
    />
  );
}
