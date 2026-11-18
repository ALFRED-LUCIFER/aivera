'use client';

import { useTranslations } from '@aivera/i18n/react';
import { Button } from '@aivera/ui';

// The jobs list could not be read (AIV-P3-004 X4). The candidate frame stays; the reason is in the server log.
export default function JobsError({ retry }: { error: unknown; retry: () => void }) {
  const t = useTranslations('candidate.jobs');
  return (
    <div role="alert" className="flex flex-col items-start gap-3">
      <h1 className="font-display text-title tracking-tight">{t('title')}</h1>
      <p className="text-text-2">{t('failed')}</p>
      <Button onClick={() => retry()}>{t('retry')}</Button>
    </div>
  );
}
