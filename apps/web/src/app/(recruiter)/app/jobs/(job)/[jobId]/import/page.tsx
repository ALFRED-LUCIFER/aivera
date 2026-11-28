import { ImportSources } from '@/features/import/components/ImportSources.tsx';
import { importView } from '@/features/import/domain/importPage.ts';
import { loadImportJobs } from '@/features/import/services/loadImportJobs.ts';
import { loadJob } from '../loadJob.ts';
import { jobPageMetadata } from '../metadata.ts';
import { ImportClient } from './ImportClient.tsx';

export const generateMetadata = jobPageMetadata('import');

// Add CVs, the job's stage once called Bring in candidates (AIV-P1-101, AIV-P1-165). The job comes from the layout's own read (loadJob, through the member's job scope),
// so another workspace's job is the layout's 404 and an ungranted one its 403. Admins and recruiters bring candidates
// in; a granted hiring owner or interviewer reads why they cannot, and the add-applicants action refuses them anyway.
export default async function ImportPage({ params }: PageProps<'/app/jobs/[jobId]/import'>) {
  const loaded = await loadJob((await params).jobId);
  // No workspace, or not found or forbidden: the layout renders that instead.
  if (!loaded || 'missing' in loaded) return null;
  if (!loaded.canImport) return <ImportSources readOnly />;
  const { jobs, agency } = await loadImportJobs();
  return <ImportClient view={importView(jobs, loaded.header)} agency={agency} />;
}
