'use client';

import { useTranslations } from '@credalent/i18n/react';
import { Button, Card } from '@credalent/ui';
import { PageHeader } from '@/features/shell/components/PageHeader.tsx';

// The error itself is not shown or logged here: its message may carry data; the server log has it by digest.
export default function WorkspaceError({ retry }: { error: unknown; retry: () => void }) {
  const t = useTranslations('ops.workspaces');
  return (
    <>
      <PageHeader title={t('title')} />
      <Card>
        <p role="alert" className="mb-3 text-body text-text">
          {t('detail.error')}
        </p>
        <Button onClick={retry}>{t('retry')}</Button>
      </Card>
    </>
  );
}
