'use client';

import { useTranslations } from '@credalent/i18n/react';
import { Button, StatusBadge, type StatusBadgeStatus } from '@credalent/ui';
import type { CvRetryView, CvState, CvView } from '../domain/cvStatus.ts';

// AIV-P1-165 §7 and AIV-P1-134: a not-yet-scored CV's state, with an icon and a word (never colour alone), and a
// secondary "Try again" where a person can do something. Shared by the ranking row and the profile.
// Deviation: neither the Candidates nor the Candidate artboard draws a CV status; the shared StatusBadge carries it.

// The parse statuses keep the words AIV-P1-025 gave them (`evidence.cvStatus.*`).
const WORDS = {
  reading: 'pending',
  waiting: 'waiting',
  unreadable: 'unreadable',
  failed: 'failed',
  assessing: 'assessing',
  couldNotAssess: 'couldNotAssess',
  noCv: 'noCv',
  afterApproval: 'afterApproval',
} as const satisfies Record<CvState, string>;

const BADGE: Record<CvState, StatusBadgeStatus> = {
  reading: 'informational',
  waiting: 'informational',
  assessing: 'informational',
  noCv: 'informational',
  afterApproval: 'informational',
  unreadable: 'needsValidation',
  failed: 'needsValidation',
  couldNotAssess: 'needsValidation',
};

export function CvStatusLine({
  cv,
  name,
  retry,
}: {
  cv: CvView;
  /** Who the CV is: names "Try again" for a screen reader, among many rows. */
  name: string;
  /** Only for admins and recruiters, who may retry. */
  retry?: CvRetryView | undefined;
}) {
  const t = useTranslations('evidence.cvStatus');
  const target = cv.retry;
  const problem = target && retry?.problemFor(target);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <StatusBadge status={BADGE[cv.state]} label={t(WORDS[cv.state])} />
      {target && retry && (
        <Button
          size="compact"
          disabled={retry.pending}
          aria-label={t('retryFor', { name })}
          onClick={() => retry.onRetry(target)}
        >
          {t('retry')}
        </Button>
      )}
      {problem && <output className="text-meta text-text-2">{t(`retryProblem.${problem}`)}</output>}
    </span>
  );
}
