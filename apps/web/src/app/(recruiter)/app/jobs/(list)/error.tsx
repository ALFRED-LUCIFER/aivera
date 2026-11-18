'use client';

import { useTranslations } from '@aivera/i18n/react';
import { JobsList } from '@/features/jobs-list/components/JobsList.tsx';
import { JobsHeader } from './JobsHeader.tsx';

// The error itself is not shown or logged here: its message may carry data; the server log has it by digest.
export default function JobsError({ retry }: { error: unknown; retry: () => void }) {
  const t = useTranslations();
  return (
    <>
      <JobsHeader title={t('shell.nav.jobs')} intro={t('jobsList.intro')} add={t('jobsList.add')} />
      <JobsList view={{ status: 'error', onRetry: retry }} />
    </>
  );
}
