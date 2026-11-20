'use client';

import { useTranslations } from '@credalent/i18n/react';
import { AuditLog } from '@/features/ops/components/AuditLog.tsx';
import { PageHeader } from '@/features/shell/components/PageHeader.tsx';

// The error itself is not shown or logged here: its message may carry data; the server log has it by digest.
export default function AuditError({ retry }: { error: unknown; retry: () => void }) {
  const t = useTranslations('ops.audit');
  return (
    <>
      <PageHeader title={t('title')} />
      <AuditLog table={{ status: 'error', onRetry: retry }} />
    </>
  );
}
