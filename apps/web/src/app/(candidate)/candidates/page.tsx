import { defaultLocale, defaultTimeZone, formatMoney, getTranslations } from '@aivera/i18n';
import { log } from '@aivera/observability';
import { newJobs } from '@/features/candidate-home/domain/new-jobs.ts';
import { PLUS_MONTHLY_PRICE } from '@/features/candidate-shell/domain/plus.ts';
import { postedDaysAgo } from '@/features/public-jobs/domain/jobs-list.ts';
import { getPublicJobs } from '@/server/publicJobs';
import { HomeView } from './HomeView.tsx';
// The website's hero motion (mk-rise), shared with the CHome hero; a feature's components/ holds .tsx only.
import '../../(marketing)/marketing.css';

// Public: the candidate home page (AIV-P3-003), server-rendered. If the jobs cannot be read the rest still renders and
// "New this week" says so; the log carries a code only.
export default async function CandidateHome() {
  const t = await getTranslations(defaultLocale, defaultTimeZone);
  const jobs = await getPublicJobs()
    .listPublicJobs()
    .catch((error: unknown) => {
      log.error(
        {
          area: 'candidate-home',
          code: 'public_jobs_unavailable',
          'error.type': error instanceof Error ? error.name : 'unknown',
        },
        'public jobs read failed',
      );
      return null;
    });
  // shortcut: the system clock, not the injected Clock port (AGENTS.md 3.9); take it from the port when the web app
  // has one. Reading the jobs per request also relies on the root layout's cookie read keeping this page dynamic.
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
      plusPrice={t('money.monthly', { amount: formatMoney(PLUS_MONTHLY_PRICE, defaultLocale) })}
    />
  );
}
