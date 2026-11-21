'use client';

import { useTranslations } from '@credalent/i18n/react';
import { Button, Card } from '@credalent/ui';
import { PageHeader } from '@/features/shell/components/PageHeader.tsx';

// The error itself is not shown or logged here: its message may carry data; the server log has it by digest.
export default function CatalogueVersionsError({ retry }: { error: unknown; retry: () => void }) {
  const t = useTranslations('ops.catalogue');
  return (
    <>
      <PageHeader title={t('history.title')} />
      <Card>
        <p role="alert" className="mb-3 text-body text-text">
          {t('history.error')}
        </p>
        <Button onClick={retry}>{t('retry')}</Button>
      </Card>
    </>
  );
}
