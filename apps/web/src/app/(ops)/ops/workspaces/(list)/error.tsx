'use client';

import { useTranslations } from '@aivera/i18n/react';
import { WorkspacesList } from '@/features/ops/components/WorkspacesList.tsx';
import { PageHeader } from '@/features/shell/components/PageHeader.tsx';

// The error itself is not shown or logged here: its message may carry data; the server log has it by digest.
export default function WorkspacesError({ retry }: { error: unknown; retry: () => void }) {
  const t = useTranslations('ops.workspaces');
  return (
    <>
      <PageHeader title={t('title')} />
      <WorkspacesList table={{ status: 'error', onRetry: retry }} />
    </>
  );
}
