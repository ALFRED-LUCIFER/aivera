'use client';

import { useTranslations } from '@aivera/i18n/react';
import { Button } from '@aivera/ui';

// A job read that failed (the layout's or a page's). The error itself is not shown or logged here: its message may
// carry data; the server log has it by digest.
export default function JobError({ retry }: { error: unknown; retry: () => void }) {
  const t = useTranslations('jobHeader');
  return (
    <div role="alert" className="flex flex-col items-start gap-3">
      <p className="text-body text-text">{t('error')}</p>
      <Button onClick={retry}>{t('retry')}</Button>
    </div>
  );
}
