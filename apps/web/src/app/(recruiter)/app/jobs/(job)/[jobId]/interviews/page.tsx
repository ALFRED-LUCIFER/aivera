import { defaultLocale, defaultTimeZone, getTranslations } from '@aivera/i18n';
import { EmptyStage } from '@/features/job-header/components/EmptyStage.tsx';
import { jobPageMetadata } from '../metadata.ts';

export const generateMetadata = jobPageMetadata('interviews');

// shortcut: says why it is empty until the interviews module (AIV-P2-001, AIV-P2-002) replaces it.
export default async function JobInterviewsPage() {
  const t = await getTranslations(defaultLocale, defaultTimeZone);
  return <EmptyStage message={t('jobHeader.empty.interviews')} />;
}
