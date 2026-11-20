'use client';

import { useTranslations } from '@credalent/i18n/react';
import { Button } from '@credalent/ui';
import { PageHeader } from '@/features/shell/components/PageHeader.tsx';

// Add a job could not load, most often the catalogue read (AIV-P2-044): no job type list from code is shown instead.
// The error itself is not shown or logged here: its message may carry data; the server log has it by digest.
export default function NewJobError({ retry }: { error: unknown; retry: () => void }) {
  const t = useTranslations('jobNew');
  return (
    <>
      <PageHeader title={t('title')} />
      <div role="alert" className="flex flex-col items-start gap-3">
        <p className="text-body text-text">{t('catalogueError')}</p>
        <Button onClick={retry}>{t('retry')}</Button>
      </div>
    </>
  );
}
