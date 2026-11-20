import { defaultLocale, defaultTimeZone, getTranslations } from '@credalent/i18n';
import { DeskApprovals } from '@/features/desk/components/DeskApprovals.tsx';
import { PageHeader } from '@/features/shell/components/PageHeader.tsx';

export default async function DeskLoading() {
  const t = await getTranslations(defaultLocale, defaultTimeZone);
  return (
    <>
      <PageHeader title={t('shell.nav.desk')} />
      <DeskApprovals state={{ status: 'loading' }} />
    </>
  );
}
