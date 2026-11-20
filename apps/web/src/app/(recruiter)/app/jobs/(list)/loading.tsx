import { defaultLocale, defaultTimeZone, getTranslations } from '@credalent/i18n';
import { JobsList } from '@/features/jobs-list/components/JobsList.tsx';
import { JobsHeader } from './JobsHeader.tsx';

export default async function JobsLoading() {
  const t = await getTranslations(defaultLocale, defaultTimeZone);
  return (
    <>
      <JobsHeader title={t('shell.nav.jobs')} intro={t('jobsList.intro')} add={t('jobsList.add')} />
      <JobsList view={{ status: 'loading' }} />
    </>
  );
}
