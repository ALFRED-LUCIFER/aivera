'use client';

import { useTranslations } from '@aivera/i18n/react';
import { ApprovalsList } from '@/features/ops/components/ApprovalsList.tsx';
import { PageHeader } from '@/features/shell/components/PageHeader.tsx';

// The error itself is not shown or logged here: its message may carry data; the server log has it by digest.
export default function ApprovalsError({ retry }: { error: unknown; retry: () => void }) {
  const t = useTranslations('ops.approvals');
  return (
    <>
      <PageHeader title={t('title')} />
      <ApprovalsList rows={[]} failed={{ onRetry: retry }} />
    </>
  );
}
