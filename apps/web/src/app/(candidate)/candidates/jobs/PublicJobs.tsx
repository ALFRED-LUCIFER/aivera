'use client';

import { JobsList, type JobsListProps } from '@/features/public-jobs/components/JobsList.tsx';
import { useJobFiltersController } from '@/features/public-jobs/hooks/useJobFiltersController.ts';

export function PublicJobs(props: Omit<JobsListProps, 'onFilterChange' | 'pending'>) {
  const controller = useJobFiltersController(props.q, props.filter);
  return <JobsList {...props} {...controller} />;
}
