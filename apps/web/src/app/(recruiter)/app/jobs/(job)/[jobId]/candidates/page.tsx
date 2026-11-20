import { defaultLocale, defaultTimeZone, getTranslations } from '@credalent/i18n';
import { EmptyStage } from '@/features/job-header/components/EmptyStage.tsx';
import { jobPageMetadata } from '../metadata.ts';

export const generateMetadata = jobPageMetadata('candidates');

// shortcut: says why it is empty until the ranked candidates table (AIV-P1-034) replaces it.
export default async function CandidatesPage() {
  const t = await getTranslations(defaultLocale, defaultTimeZone);
  return <EmptyStage message={t('jobHeader.empty.candidates')} />;
}
