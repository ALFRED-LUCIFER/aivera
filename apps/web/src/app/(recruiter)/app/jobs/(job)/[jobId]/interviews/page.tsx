import { defaultLocale, defaultTimeZone, getTranslations } from '@credalent/i18n';
import { buttonClassName } from '@credalent/ui';
import type { Route } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadInterviews } from '@/features/interviews/services/loadInterviews.ts';
import { jobPageHref } from '@/features/job-header/domain/jobHeader.ts';
import { InterviewsClient } from '../../../../interviews/(list)/InterviewsClient.tsx';
import { jobPageMetadata } from '../metadata.ts';

export const generateMetadata = jobPageMetadata('interviews');

// A job's Interviews tab (AIV-P1-165 §12): this job's interviews in the Interviews list, each with "Start interview"
// or its scorecard. With none, it says how to choose candidates and offers "Go to ranking", the page's one primary
// action. The job layout has checked the member may see the job; the interviews contract narrows the list again.
// Deviation: no artboard draws a job's Interviews tab; it reuses the Interviews list (Interviews.dc.html).
export default async function JobInterviewsPage({ params }: PageProps<'/app/jobs/[jobId]/interviews'>) {
  const { jobId } = await params;
  const [t, data] = await Promise.all([getTranslations(defaultLocale, defaultTimeZone), loadInterviews(jobId)]);
  if (!data) notFound();
  return (
    <InterviewsClient
      {...data}
      empty={
        <div className="flex flex-col items-start gap-4">
          <p className="max-w-[72ch] text-body text-text">{t('interviews.emptyJob')}</p>
          {/* jobPageHref builds the path from the job id, which typed routes cannot check. */}
          <Link href={jobPageHref(jobId, 'candidates') as Route} className={buttonClassName('primary')}>
            {t('interviews.goToRanking')}
          </Link>
        </div>
      }
    />
  );
}
