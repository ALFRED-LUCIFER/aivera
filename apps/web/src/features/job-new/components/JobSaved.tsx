import { useTranslations } from '@aivera/i18n/react';
import { buttonClassName } from '@aivera/ui';
import Link from 'next/link';

// Stable, so focus moves here once, when the saved state replaces the form it came from.
const focusOnMount = (element: HTMLElement | null) => element?.focus();

/** Add a job, after "Save job and rubric" (AIV-P1-010): the job and rubric version 1, a draft, are saved. */
export function JobSaved() {
  const t = useTranslations('jobNew');
  return (
    <section className="flex max-w-2xl flex-col gap-3">
      <output tabIndex={-1} ref={focusOnMount} className="block text-body font-semibold text-text">
        {t('saved')}
      </output>
      <p className="text-body text-text-2">{t('savedNext')}</p>
      {/* shortcut: "Send rubric for approval" joins this as the primary action with AIV-P1-014, which builds the
          sending and the hiring owner's email; until then the job waits in Jobs as "Draft, needs approval". */}
      <div className="mt-3 flex flex-wrap gap-2">
        <Link href="/app/jobs" className={buttonClassName('primary')}>
          {t('backToJobs')}
        </Link>
      </div>
    </section>
  );
}
