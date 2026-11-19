'use client';

import { JobHeader } from '@/features/job-header/components/JobHeader.tsx';
import type { JobHeaderView } from '@/features/job-header/domain/jobHeader.ts';
import { useCurrentJobPage } from '@/features/job-header/hooks/useCurrentJobPage.ts';

export function JobHeaderNav({ view }: { view: JobHeaderView }) {
  return <JobHeader view={view} current={useCurrentJobPage()} />;
}
