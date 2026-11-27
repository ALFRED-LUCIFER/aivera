import { defaultLocale, defaultTimeZone, getTranslations } from '@credalent/i18n';
import { People } from '@/features/people/components/People.tsx';
import { PageHeader } from '@/features/shell/components/PageHeader.tsx';

export default async function CandidatesLoading() {
  const t = await getTranslations(defaultLocale, defaultTimeZone);
  return (
    <>
      <PageHeader title={t('shell.nav.candidates')} />
      <People view={{ status: 'loading' }} />
    </>
  );
}
