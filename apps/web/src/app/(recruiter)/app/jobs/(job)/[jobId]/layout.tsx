import { forbidden, notFound } from 'next/navigation';
import { jobHeaderView } from '@/features/job-header/domain/jobHeader.ts';
import { loadJob } from './loadJob.ts';
import { JobHeaderNav } from './JobHeaderNav.tsx';

// Every job page (rubric, candidates, interviews, decision) shares this header (AIV-P1-011). An unknown or other
// workspace's job is the 404 in ../not-found.tsx: a layout's notFound() reaches the boundary above it. No
// requireScreen('jobs'): granted hiring owners and interviewers open their jobs too, and job.view decides.
export default async function JobLayout({ children, params }: LayoutProps<'/app/jobs/[jobId]'>) {
  const loaded = await loadJob((await params).jobId);
  // No workspace yet: the recruiter layout shows the create-workspace page instead.
  if (!loaded) return null;
  if ('missing' in loaded) return loaded.missing === 'forbidden' ? forbidden() : notFound();
  return (
    <>
      <JobHeaderNav
        view={jobHeaderView(
          loaded.header,
          loaded.hiringOwner,
          loaded.assessed,
          loaded.ownerChange,
          loaded.imported,
          loaded.shortlistReady,
        )}
        canImport={loaded.canImport}
      />
      {children}
    </>
  );
}
