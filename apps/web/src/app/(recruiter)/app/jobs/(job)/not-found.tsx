import { defaultLocale, defaultTimeZone, getTranslations } from '@credalent/i18n';
import { PageHeader } from '@/features/shell/components/PageHeader.tsx';

// A job id the workspace does not have, from another workspace or none at all: one 404, so an id says nothing.
export default async function JobNotFound() {
  const t = await getTranslations(defaultLocale, defaultTimeZone);
  return (
    <>
      <PageHeader title={t('jobHeader.notFoundTitle')} />
      <p className="text-body text-text-2">{t('jobHeader.notFound')}</p>
    </>
  );
}
