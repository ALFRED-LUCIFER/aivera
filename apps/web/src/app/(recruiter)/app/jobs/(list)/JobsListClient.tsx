'use client';

import { JobsList } from '@/features/jobs-list/components/JobsList.tsx';
import type { ClientOption, JobRow } from '@/features/jobs-list/domain/jobsList.ts';
import { useJobsListController } from '@/features/jobs-list/hooks/useJobsListController.ts';

type Props = { rows: JobRow[]; clients: ClientOption[] | null; canImport: boolean };

export function JobsListClient({ rows, clients, canImport }: Props) {
  return <JobsList view={useJobsListController(rows, clients)} canImport={canImport} />;
}
