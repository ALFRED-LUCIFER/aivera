'use client';

import { JobsList } from '@/features/jobs-list/components/JobsList.tsx';
import type { JobRow } from '@/features/jobs-list/domain/jobsList.ts';
import { useJobsListController } from '@/features/jobs-list/hooks/useJobsListController.ts';

export function JobsListClient({ rows, agency, canImport }: { rows: JobRow[]; agency: boolean; canImport: boolean }) {
  return <JobsList view={useJobsListController(rows, agency)} canImport={canImport} />;
}
