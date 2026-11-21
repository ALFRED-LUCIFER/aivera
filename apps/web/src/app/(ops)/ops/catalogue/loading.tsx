import { defaultLocale, defaultTimeZone, getTranslations } from '@credalent/i18n';
import { PageHeader } from '@/features/shell/components/PageHeader.tsx';

// Shown inside the layout, which has already checked the policy; it holds no catalogue data.
export default async function CatalogueLoading() {
  const t = await getTranslations(defaultLocale, defaultTimeZone);
  return (
    <>
      <PageHeader title={t('ops.catalogue.title')} />
      <output className="block text-body text-text-2">{t('ops.catalogue.loading')}</output>
    </>
  );
}
