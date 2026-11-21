import { defaultLocale, defaultTimeZone, getTranslations } from '@credalent/i18n';
import { PageHeader } from '@/features/shell/components/PageHeader.tsx';

// Shown inside the layout, which has already checked the policy; it holds no catalogue data.
export default async function CatalogueVersionsLoading() {
  const t = await getTranslations(defaultLocale, defaultTimeZone);
  return (
    <>
      <PageHeader title={t('ops.catalogue.history.title')} />
      <output className="block text-body text-text-2">{t('ops.catalogue.history.loading')}</output>
    </>
  );
}
