'use client';

import { JobDetailFailed } from '@/features/public-jobs/components/JobDetail.tsx';

// The job could not be read (AIV-P3-005 X4); the reason is in the server log.
export default function JobError({ retry }: { error: unknown; retry: () => void }) {
  return <JobDetailFailed onRetry={() => retry()} />;
}
