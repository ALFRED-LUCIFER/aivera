'use client';

import { useTranslations } from '@credalent/i18n/react';
import { People } from '@/features/people/components/People.tsx';
import { PageHeader } from '@/features/shell/components/PageHeader.tsx';

// The error itself is not shown or logged here: its message may carry data; the server log has it by digest.
export default function CandidatesError({ retry }: { error: unknown; retry: () => void }) {
  const t = useTranslations();
  return (
    <>
      <PageHeader title={t('shell.nav.candidates')} />
      <People view={{ status: 'error', onRetry: retry }} />
    </>
  );
}
