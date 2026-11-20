import { defaultLocale, defaultTimeZone, getTranslations } from '@credalent/i18n';
import { EmptyStage } from '@/features/job-header/components/EmptyStage.tsx';
import { jobPageMetadata } from '../metadata.ts';

export const generateMetadata = jobPageMetadata('pack');

// shortcut: says why it is empty until the decision pack (AIV-P2-010, AIV-P2-011) replaces it.
export default async function JobPackPage() {
  const t = await getTranslations(defaultLocale, defaultTimeZone);
  return <EmptyStage message={t('jobHeader.empty.pack')} />;
}
