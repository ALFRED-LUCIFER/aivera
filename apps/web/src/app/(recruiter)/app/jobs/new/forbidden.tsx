import { defaultLocale, defaultTimeZone, getTranslations } from '@aivera/i18n';
import { PageHeader } from '@/features/shell/components/PageHeader.tsx';

// What `forbidden()` renders under Add a job, with HTTP 403: the member's role may not create jobs (`job.create`).
export default async function Forbidden() {
  const t = await getTranslations(defaultLocale, defaultTimeZone);
  return (
    <>
      <PageHeader title={t('access.forbiddenTitle')} />
      <p className="text-body text-text-2">{t('jobNew.forbidden')}</p>
    </>
  );
}
