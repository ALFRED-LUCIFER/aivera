import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { jobPageHref } from '@/features/job-header/domain/jobHeader.ts';

/** Choosing another job opens that job's import page; the URL carries its opaque id only (AIV-P1-101). */
export function useImportController() {
  const router = useRouter();
  return { onPick: (jobId: string) => router.push(jobPageHref(jobId, 'import') as Route) };
}
