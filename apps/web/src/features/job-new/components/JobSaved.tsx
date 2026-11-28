import { useTranslations } from '@credalent/i18n/react';
import { Button, buttonClassName } from '@credalent/ui';
import type { Route } from 'next';
import Link from 'next/link';
import { jobPageHref } from '@/features/job-header/domain/jobHeader.ts';

// Stable, so focus moves here once, when the saved state replaces the form it came from.
const focusOnMount = (element: HTMLElement | null) => element?.focus();

type Props = {
  status: 'idle' | 'sent' | 'sentNoOwner' | 'failed';
  pending: boolean;
  onSend: () => void;
  jobId: string | undefined;
  /** Sending is on here (OUTBOUND); off in the pilot, where nothing is sent (AIV-P1-165). */
  canSend: boolean;
};

/**
 * Add a job, after "Save job and rubric" (AIV-P1-010): the job and rubric version 1, a draft, are saved. The one primary
 * action is "Review and approve the rubric" (AIV-P1-165); "Send rubric for approval" emails the hiring owner (AIV-P1-014)
 * and is shown only where sending is on. Deviations from the RoleNew artboard: "See talent pool matches" is left out
 * until the talent pool exists (AIV-P2-022); "Review and approve the rubric" replaces "Send rubric for approval" as the
 * primary, since the recruiter approves alone in the pilot (AIV-P1-165).
 */
export function JobSaved({ status, pending, onSend, jobId, canSend }: Props) {
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
        {jobId && (
          <Link href={jobPageHref(jobId, 'rubric') as Route} className={buttonClassName('primary')}>
            {t('reviewRubric')}
          </Link>
        )}
        {canSend && (
          <Button disabled={pending} onClick={onSend}>
            {t('sendRubric')}
          </Button>
        )}
        <Link href="/app/jobs" className={buttonClassName('secondary')}>
          {t('backToJobs')}
        </Link>
      </div>
    </section>
  );
}
