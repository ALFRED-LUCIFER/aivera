import { defaultLocale, defaultTimeZone, getTranslations } from '@aivera/i18n';
import { PageHeader } from '@/features/shell/components/PageHeader.tsx';

// Shown inside the layout, which has already checked the policy; it holds no workspace data.
export default async function ApprovalsLoading() {
  const t = await getTranslations(defaultLocale, defaultTimeZone);
  return (
    <>
      <PageHeader title={t('ops.approvals.title')} />
      <output className="block text-body text-text-2">{t('ops.approvals.loading')}</output>
    </>
  );
}
