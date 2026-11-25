import { defaultLocale, defaultTimeZone, getTranslations } from '@credalent/i18n';
import { InterviewsList } from '@/features/interviews/components/InterviewsList.tsx';
import { PageHeader } from '@/features/shell/components/PageHeader.tsx';

export default async function InterviewsLoading() {
  const t = await getTranslations(defaultLocale, defaultTimeZone);
  return (
    <>
      <PageHeader title={t('shell.nav.interviews')} description={t('interviews.intro')} />
      <InterviewsList view={{ status: 'loading' }} />
    </>
  );
}
