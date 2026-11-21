import { defaultLocale, defaultTimeZone, getTranslations } from '@credalent/i18n';
import { PageHeader } from '@/features/shell/components/PageHeader.tsx';

// A number no published catalogue version has (a draft's included). Inside the layout, which checked the policy.
export default async function CatalogueVersionNotFound() {
  const t = await getTranslations(defaultLocale, defaultTimeZone);
  return (
    <>
      <PageHeader title={t('ops.catalogue.history.notFoundTitle')} />
      <p className="text-body text-text-2">{t('ops.catalogue.history.notFound')}</p>
    </>
  );
}
