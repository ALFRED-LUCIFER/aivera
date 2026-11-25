import { defaultLocale, defaultTimeZone, getTranslations } from '@credalent/i18n';
import { notFound } from 'next/navigation';
import { loadInterviews } from '@/features/interviews/services/loadInterviews.ts';
import { PageHeader } from '@/features/shell/components/PageHeader.tsx';
import { requireScreen } from '@/features/shell/services/request.ts';
import { screenMetadata } from '../../Placeholder.tsx';
import { InterviewsClient } from './InterviewsClient.tsx';

export const generateMetadata = screenMetadata('interviews');

// The Interviews list (AIV-P2-002). Loading and error states: loading.tsx and error.tsx beside this page, inside the
// (list) group so an interview's scorecard page (../[interviewId], AIV-P2-004) keeps its own. Every role opens it; the interviews contract
// returns only the jobs the member is granted and, to an interviewer, their own interviews.
export default async function InterviewsPage() {
  await requireScreen('interviews');
  const [t, data] = await Promise.all([getTranslations(defaultLocale, defaultTimeZone), loadInterviews()]);
  if (!data) notFound();
  return (
    <>
      <PageHeader title={t('shell.nav.interviews')} description={t('interviews.intro')} />
      <InterviewsClient {...data} />
    </>
  );
}
