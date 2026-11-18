'use client';

import { JobsListFailed } from '@/features/public-jobs/components/JobsList.tsx';

// The jobs list could not be read (AIV-P3-004 X4); the reason is in the server log.
export default function JobsError({ retry }: { error: unknown; retry: () => void }) {
  return <JobsListFailed onRetry={() => retry()} />;
}
