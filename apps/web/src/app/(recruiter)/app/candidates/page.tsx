import { defaultLocale, defaultTimeZone, getTranslations } from '@credalent/i18n';
import { notFound } from 'next/navigation';
import { loadPeople } from '@/features/people/services/loadPeople.ts';
import { PageHeader } from '@/features/shell/components/PageHeader.tsx';
import { requireScreen } from '@/features/shell/services/request.ts';
import { screenMetadata } from '../Placeholder.tsx';
import { PeopleClient } from './PeopleClient.tsx';

export const generateMetadata = screenMetadata('candidates');

// Candidates (all jobs), AIV-P1-048: admins and recruiters only (the screen's capability). Loading and error states:
// loading.tsx and error.tsx beside this page. The workspace comes from the request context, never the browser (ADR-005).
export default async function CandidatesPage() {
  await requireScreen('candidates');
  const data = await loadPeople();
  if (!data) notFound();
  const t = await getTranslations(defaultLocale, defaultTimeZone);
  return (
    <>
      <PageHeader title={t('shell.nav.candidates')} />
      <PeopleClient data={data} />
    </>
  );
}
