import { useTranslations } from '@aivera/i18n/react';
import { Button, buttonClassName } from '@aivera/ui';
import Link from 'next/link';

// Stable, so focus moves here once, when the saved state replaces the form it came from.
const focusOnMount = (element: HTMLElement | null) => element?.focus();

type Props = { status: 'idle' | 'sent' | 'sentNoOwner' | 'failed'; pending: boolean; onSend: () => void };

/**
 * Add a job, after "Save job and rubric" (AIV-P1-010): the job and rubric version 1, a draft, are saved. "Send rubric
 * for approval" emails the hiring owner (AIV-P1-014). The RoleNew artboard's "See talent pool matches" is left out
 * until the talent pool exists (AIV-P2-022).
 */
export function JobSaved({ status, pending, onSend }: Props) {
  const t = useTranslations('jobNew');
  if (status === 'sent' || status === 'sentNoOwner')
    return (
      <section className="flex max-w-2xl flex-col gap-3">
        {/* RoleNew artboard: the sent message is regular secondary text. */}
        <output tabIndex={-1} ref={focusOnMount} className="block text-body text-text-2">
          {t(status)}
        </output>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href="/app/jobs" className={buttonClassName('primary')}>
            {t('goToJobs')}
          </Link>
        </div>
      </section>
    );
  return (
    <section className="flex max-w-2xl flex-col gap-3">
      <output tabIndex={-1} ref={focusOnMount} className="block text-body font-semibold text-text">
        {t('saved')}
      </output>
      <p className="text-body text-text-2">{t('savedNext')}</p>
      {status === 'failed' && (
        <p role="alert" className="text-body text-err-text">
          {t('sendFailed')}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="primary" disabled={pending} onClick={onSend}>
          {t('sendRubric')}
        </Button>
        <Link href="/app/jobs" className={buttonClassName('secondary')}>
          {t('backToJobs')}
        </Link>
      </div>
    </section>
  );
}
