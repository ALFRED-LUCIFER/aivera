'use client';

import { useTranslations } from '@credalent/i18n/react';
import { InterviewsList } from '@/features/interviews/components/InterviewsList.tsx';
import { PageHeader } from '@/features/shell/components/PageHeader.tsx';

// The error itself is not shown or logged here: its message may carry data; the server log has it by digest.
export default function InterviewsError({ retry }: { error: unknown; retry: () => void }) {
  const t = useTranslations();
  return (
    <>
      <PageHeader title={t('shell.nav.interviews')} description={t('interviews.intro')} />
      <InterviewsList view={{ status: 'error', onRetry: retry }} />
    </>
  );
}
