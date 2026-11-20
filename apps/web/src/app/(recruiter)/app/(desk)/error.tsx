'use client';

import { useTranslations } from '@credalent/i18n/react';
import { DeskApprovals } from '@/features/desk/components/DeskApprovals.tsx';
import { PageHeader } from '@/features/shell/components/PageHeader.tsx';

// The error itself is not shown or logged here: its message may carry data; the server log has it by digest.
export default function DeskError({ retry }: { error: unknown; retry: () => void }) {
  const t = useTranslations();
  return (
    <>
      <PageHeader title={t('shell.nav.desk')} />
      <DeskApprovals state={{ status: 'error', onRetry: retry }} />
    </>
  );
}
