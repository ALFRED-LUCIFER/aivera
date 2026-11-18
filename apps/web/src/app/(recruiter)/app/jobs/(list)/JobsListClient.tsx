'use client';

import { JobsList } from '@/features/jobs-list/components/JobsList.tsx';
import type { JobRow } from '@/features/jobs-list/domain/jobsList.ts';
import { useJobsListController } from '@/features/jobs-list/hooks/useJobsListController.ts';

export function JobsListClient({ rows }: { rows: JobRow[] }) {
  return <JobsList view={useJobsListController(rows)} />;
}
