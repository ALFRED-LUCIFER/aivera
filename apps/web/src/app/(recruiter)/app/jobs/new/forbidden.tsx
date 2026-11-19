import { defaultLocale, defaultTimeZone, getTranslations } from '@aivera/i18n';
import { PageHeader } from '@/features/shell/components/PageHeader.tsx';
import { currentMembership } from '@/server/workspace';

// What `forbidden()` renders under Add a job, with HTTP 403: the member's role may not create jobs (`job.create`), or
// the workspace is suspended (AIV-P2-037).
export default async function Forbidden() {
  const t = await getTranslations(defaultLocale, defaultTimeZone);
  const paused = (await currentMembership().catch(() => null))?.status === 'suspended';
  return (
    <>
      <PageHeader title={paused ? t('access.pausedTitle') : t('access.forbiddenTitle')} />
      <p className="text-body text-text-2">{paused ? t('access.paused') : t('jobNew.forbidden')}</p>
    </>
  );
}
