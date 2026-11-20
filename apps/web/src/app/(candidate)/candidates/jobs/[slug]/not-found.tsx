import { defaultLocale, defaultTimeZone, getTranslations } from '@credalent/i18n';
import { buttonClassName } from '@credalent/ui';
import Link from 'next/link';

// A job that was taken down, or a link no job ever had: the same 404 for both, so a slug says nothing about history.
export default async function JobNotFound() {
  const t = await getTranslations(defaultLocale, defaultTimeZone);
  return (
    <div className="flex flex-col items-start gap-3">
      <h1 className="font-display text-title tracking-tight">{t('candidate.job.closedTitle')}</h1>
      <p className="text-text-2">{t('candidate.job.closedBody')}</p>
      <Link href="/candidates/jobs" className={buttonClassName('secondary')}>
        {t('candidate.job.allJobs')}
      </Link>
    </div>
  );
}
