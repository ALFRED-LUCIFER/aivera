'use client';

import { useTranslations } from '@credalent/i18n/react';
import { Button } from '@credalent/ui';
import { PageHeader } from '@/features/shell/components/PageHeader.tsx';

// The error itself is not shown or logged here: its message may carry data; the server log has it by digest.
export default function MembersError({ retry }: { error: unknown; retry: () => void }) {
  const t = useTranslations('members');
  return (
    <>
      <PageHeader title={t('title')} />
      <p role="alert" className="mb-4 text-body text-text">
        {t('error')}
      </p>
      <Button onClick={retry}>{t('retry')}</Button>
    </>
  );
}
